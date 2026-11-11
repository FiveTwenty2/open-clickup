import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { encodeCsv, parseCsv } from "@/lib/csv";
import { isCompletedStatus } from "@/lib/task-status";
import { publish } from "@/lib/events";
import type { Priority } from "@/lib/generated/prisma/client";

const headers = ["Task ID", "Parent Task ID", "Task Name", "Status", "Priority", "Assignees", "Start Date", "Due Date", "Description"];
const normalize = (value: string) => value.trim().toLowerCase().replaceAll(/[^a-z0-9]/g, "");
const priorities = new Set(["URGENT", "HIGH", "NORMAL", "LOW"]);

function plainDescription(html: string) {
  return html.replaceAll(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replaceAll(/<[^>]*>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&").trim();
}

export async function exportListCsv(listId: string) {
  const tasks = await prisma.task.findMany({
    where: { listId, archived: false, deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true, parentId: true, name: true, priority: true, startDate: true, dueDate: true, description: true,
      status: { select: { name: true } },
      assignees: { select: { user: { select: { email: true } } } },
    },
  });
  const visibleIds = new Set(tasks.map((task) => task.id));
  return encodeCsv([headers, ...tasks.map((task) => [
    task.id, task.parentId && visibleIds.has(task.parentId) ? task.parentId : null, task.name,
    task.status.name, task.priority, task.assignees.map(({ user }) => user.email).join("; "),
    task.startDate?.toISOString(), task.dueDate?.toISOString(), task.description ? plainDescription(task.description) : "",
  ])]);
}

function readDate(value: string, label: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !/^\d{13}$/.test(value)) throw new Error(`${label} must be an ISO date`);
  const date = new Date(/^\d{13}$/.test(value) ? Number(value) : value);
  if (Number.isNaN(date.getTime()) || (value.length === 10 && date.toISOString().slice(0, 10) !== value)) throw new Error(`${label} is not a valid date`);
  return date;
}

function escapeText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(/\r?\n/g, "<br>");
}

export async function importListCsv(workspaceId: string, listId: string, userId: string, csv: string, preview: boolean) {
  let parsed: string[][];
  try { parsed = parseCsv(csv); } catch (error) { throw new ApiError(400, (error as Error).message); }
  const [columns, ...rows] = parsed;
  if (!columns || !rows.length) throw new ApiError(400, "Include a header and at least one task row");
  const column = (...names: string[]) => columns.findIndex((name) => names.includes(normalize(name)));
  const nameColumn = column("taskname", "name", "title");
  if (nameColumn < 0) throw new ApiError(400, "CSV must contain a Task Name or Name column");

  const [statuses, members] = await Promise.all([
    prisma.status.findMany({ where: { listId }, orderBy: { position: "asc" } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { user: { select: { id: true, email: true, name: true } } } }),
  ]);
  if (!statuses.length) throw new ApiError(400, "This list needs at least one status");
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const tasks = rows.flatMap((row, index) => {
    const get = (...names: string[]) => row[column(...names)]?.trim() ?? "";
    try {
      const name = row[nameColumn]?.trim();
      if (!name || name.length > 500) throw new Error("Task name is required and must be at most 500 characters");
      const sourceId = get("taskid", "id");
      if (sourceId && seen.has(sourceId)) throw new Error("Task ID is duplicated");
      const id = randomUUID();
      const statusName = get("status").toLowerCase();
      const status = statusName ? statuses.find((item) => item.name.toLowerCase() === statusName) : statuses[0];
      if (!status) throw new Error(`Status "${get("status")}" does not exist in this list`);
      const priority = get("priority").toUpperCase();
      if (priority && !priorities.has(priority)) throw new Error("Priority must be Urgent, High, Normal, or Low");
      const assigneeIds = get("assignees", "assignee", "assigneeemail").split(/[;,]/).map((value) => value.trim().toLowerCase()).filter(Boolean).map((value) => {
        const match = members.filter(({ user }) => user.email.toLowerCase() === value || user.name.toLowerCase() === value);
        if (match.length !== 1) throw new Error(`Assignee "${value}" must match exactly one workspace member`);
        return match[0].user.id;
      });
      const startDate = readDate(get("startdate"), "Start date");
      const dueDate = readDate(get("duedate"), "Due date");
      if (startDate && dueDate && startDate > dueDate) throw new Error("Start date must be on or before due date");
      const description = get("description");
      if (sourceId) seen.set(sourceId, id);
      return [{ id, sourceId, parentSource: get("parenttaskid", "parentid"), row: index + 2, name, statusId: status.id,
        completedAt: isCompletedStatus(status.type) ? new Date() : null, priority: (priority || null) as Priority | null,
        startDate, dueDate, description: description ? `<p>${escapeText(description)}</p>` : null,
        assigneeIds: [...new Set(assigneeIds)] }];
    } catch (error) {
      errors.push(`Row ${index + 2}: ${(error as Error).message}`);
      return [];
    }
  });
  const bySource = new Map(tasks.filter((task) => task.sourceId).map((task) => [task.sourceId, task]));
  for (const task of tasks) {
    const visited = new Set([task.sourceId]);
    let parent = task.parentSource;
    while (parent) {
      if (visited.has(parent)) { errors.push(`Row ${task.row}: Task hierarchy contains a cycle`); break; }
      visited.add(parent);
      const ancestor = bySource.get(parent);
      if (!ancestor) { errors.push(`Row ${task.row}: Parent Task ID is missing from this file`); break; }
      parent = ancestor.parentSource;
    }
  }
  if (errors.length || preview) return { count: tasks.length, errors, imported: false };

  await prisma.$transaction(async (tx) => {
    const last = await tx.task.aggregate({ where: { listId }, _max: { position: true } });
    const base = last._max.position ?? 0;
    await tx.task.createMany({
      data: tasks.map(({ id, name, statusId, completedAt, priority, startDate, dueDate, description, parentSource }, index) => ({
        id, listId, name, statusId, completedAt, priority, startDate, dueDate, description, createdById: userId,
        position: base + (index + 1) * 1000, parentId: parentSource ? seen.get(parentSource) : null,
      })),
    });
    const assignees = tasks.flatMap((task) => task.assigneeIds.map((assigneeId) => ({ taskId: task.id, userId: assigneeId })));
    if (assignees.length) await tx.taskAssignee.createMany({ data: assignees });
    await tx.activity.createMany({ data: tasks.map((task) => ({ taskId: task.id, userId, type: "created", data: { source: "csv" } })) });
  });
  publish({ type: "list", listId });
  publish({ type: "bootstrap" });
  return { count: tasks.length, errors, imported: true };
}
