import { randomUUID } from "node:crypto";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api-helpers";
import { isCompletedStatus } from "@/lib/task-status";

export async function snapshotList(workspaceId: string, listId: string, includeTasks: boolean) {
  const list = await prisma.list.findFirst({
    where: { id: listId, space: { workspaceId } },
    select: {
      color: true, icon: true,
      automations: { select: { name: true, enabled: true, trigger: true, statusId: true, priority: true, dueDays: true, assigneeId: true } },
      statuses: { select: { id: true, name: true, color: true, type: true, position: true, wipLimit: true } },
      views: { where: { privateOwnerId: null }, select: { name: true, type: true, config: true, position: true } },
      customFields: { select: {
        id: true, name: true, type: true, config: true, position: true,
        options: { select: { id: true, label: true, color: true, position: true } },
      } },
    },
  });
  if (!list) throw new ApiError(404, "Source list not found");
  const tasks = includeTasks ? await prisma.task.findMany({
    where: { listId, archived: false, deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 1001,
    select: {
      id: true, parentId: true, name: true, description: true, priority: true, milestone: true, statusId: true, position: true,
      startDate: true, dueDate: true, timeEstimate: true, recurrence: true,
      blocking: { select: { blockedId: true } },
      checklists: { select: { name: true, position: true, items: { select: { name: true, position: true } } } },
      customFieldValues: { select: { customFieldId: true, value: true } },
    },
  }) : [];
  if (tasks.length > 1000) throw new ApiError(400, "A list template can include up to 1,000 tasks");
  return { version: 1, ...list, tasks: tasks.map((task) => ({
    ...task, startDate: task.startDate?.toISOString() ?? null, dueDate: task.dueDate?.toISOString() ?? null,
  })) };
}

type Snapshot = Awaited<ReturnType<typeof snapshotList>>;
function viewConfig(config: Prisma.JsonValue, statusIds: Map<string, string>) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return Prisma.DbNull;
  const filters = config.filters;
  return {
    ...config,
    statusIds: Array.isArray(config.statusIds) ? config.statusIds.flatMap((id) => typeof id === "string" && statusIds.has(id) ? [statusIds.get(id)!] : []) : [],
    ...(filters && typeof filters === "object" && !Array.isArray(filters) && { filters: { ...filters, tags: [] } }),
  };
}

export async function createListFromTemplate(input: {
  workspaceId: string; templateId: string; name: string; spaceId: string; folderId?: string | null;
  includeTasks: boolean; includeDates: boolean; includeAutomations: boolean; actorId: string;
}) {
  const { workspaceId, templateId, name, spaceId, folderId } = input;
  return prisma.$transaction(async (tx) => {
    const template = await tx.listTemplate.findFirst({ where: { id: templateId, workspaceId } });
    if (!template) throw new ApiError(404, "List template not found");
    const snapshot = template.snapshot as unknown as Snapshot;
    if (snapshot.version !== 1 || !snapshot.statuses.length) throw new ApiError(409, "Unsupported template snapshot");
    const last = await tx.list.aggregate({ where: { spaceId, folderId: folderId ?? null }, _max: { position: true } });
    const statusIds = new Map(snapshot.statuses.map(({ id }) => [id, randomUUID()]));
    const fieldIds = new Map(snapshot.customFields.map(({ id }) => [id, randomUUID()]));
    const optionIds = new Map(snapshot.customFields.flatMap(({ options }) => options.map(({ id }) => [id, randomUUID()] as const)));
    const list = await tx.list.create({
      data: {
        spaceId, folderId: folderId ?? null, name, color: snapshot.color, icon: snapshot.icon,
        position: (last._max.position ?? 0) + 1000,
        statuses: { create: snapshot.statuses.map(({ id, ...status }) => ({ ...status, id: statusIds.get(id)! })) },
        views: { create: snapshot.views.map(({ config, ...view }) => ({ ...view, config: viewConfig(config, statusIds) })) },
        customFields: { create: snapshot.customFields.map(({ id, options, config, ...field }) => ({
          ...field, id: fieldIds.get(id)!, config: config ?? Prisma.DbNull,
          options: { create: options.map(({ id: optionId, ...option }) => ({ ...option, id: optionIds.get(optionId)! })) },
        })) },
      },
    });
    if (input.includeAutomations && snapshot.automations?.length) {
      const assignees = snapshot.automations.flatMap(({ assigneeId }) => assigneeId ? [assigneeId] : []);
      const members = await tx.workspaceMember.findMany({
        where: { workspaceId, userId: { in: assignees } }, select: { userId: true },
      });
      const valid = new Set(members.map((member) => member.userId));
      const rules = snapshot.automations.flatMap(({ statusId, assigneeId, ...rule }) => {
        const status = statusId ? statusIds.get(statusId) : null;
        const assignee = assigneeId && valid.has(assigneeId) ? assigneeId : null;
        if (status === undefined || (!assignee && !rule.priority && rule.dueDays === null)) return [];
        return [{ ...rule, listId: list.id, statusId: status, assigneeId: assignee }];
      });
      if (rules.length) await tx.taskAutomation.createMany({ data: rules });
    }
    const tasks = input.includeTasks ? snapshot.tasks : [];
    const taskIds = new Map(tasks.map(({ id }) => [id, randomUUID()]));
    const statusTypes = new Map(snapshot.statuses.map(({ id, type }) => [id, type]));
    if (tasks.length) await tx.task.createMany({
      data: tasks.map(({ id, parentId, startDate, dueDate, statusId, name, description, priority, position, timeEstimate, recurrence, milestone }) => ({
        id: taskIds.get(id)!, listId: list.id, parentId: parentId ? taskIds.get(parentId) ?? null : null,
        statusId: statusIds.get(statusId) ?? statusIds.get(snapshot.statuses[0].id)!,
        name, description, priority, position, timeEstimate, recurrence, milestone, createdById: input.actorId,
        completedAt: isCompletedStatus(statusTypes.get(statusId) ?? "") ? new Date() : null,
        startDate: input.includeDates ? startDate : null, dueDate: input.includeDates ? dueDate : null,
      })),
    });
    const dependencies = tasks.flatMap((task) => (task.blocking ?? []).flatMap(({ blockedId }) =>
      taskIds.has(blockedId) ? [{ blockerId: taskIds.get(task.id)!, blockedId: taskIds.get(blockedId)! }] : [],
    ));
    if (dependencies.length) await tx.taskDependency.createMany({ data: dependencies });
    const checklists = tasks.flatMap((task) => task.checklists.map((checklist) => ({
      ...checklist, id: randomUUID(), taskId: taskIds.get(task.id)!,
    })));
    if (checklists.length) await tx.checklist.createMany({ data: checklists.map(({ items: _items, ...checklist }) => checklist) });
    const items = checklists.flatMap(({ id, items }) => items.map((item) => ({ ...item, checklistId: id })));
    if (items.length) await tx.checklistItem.createMany({ data: items });
    const fieldsById = new Map(snapshot.customFields.map((field) => [field.id, field]));
    const fieldValues = tasks.flatMap((task) => task.customFieldValues.flatMap(({ customFieldId, value }) => {
      const field = fieldsById.get(customFieldId);
      if (!field || value === null) return [];
      const mapped = field.type === "DROPDOWN" && typeof value === "string" ? optionIds.get(value)
        : field.type === "LABELS" && Array.isArray(value) ? value.flatMap((id) => typeof id === "string" && optionIds.has(id) ? [optionIds.get(id)!] : []) : value;
      if (mapped === undefined) return [];
      return [{ taskId: taskIds.get(task.id)!, customFieldId: fieldIds.get(customFieldId)!, value: mapped }];
    }));
    if (fieldValues.length) await tx.customFieldValue.createMany({ data: fieldValues });
    return list;
  }, { timeout: 15000 });
}
