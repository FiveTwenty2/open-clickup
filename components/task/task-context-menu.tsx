"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { useState, type ReactElement } from "react";
import { useDeleteTask, useDuplicateTask, useUpdateTask } from "@/lib/hooks";
import { PRIORITY_CONFIG, PRIORITY_ORDER } from "@/lib/constants";
import type { StatusModel, TaskWithRelations } from "@/lib/queries";
import { isCompletedStatus, quickStatus } from "@/lib/task-status";
import { StatusCircle } from "@/components/menus/status-control";

const panel = "z-[60] min-w-44 rounded-lg border border-cu-border bg-cu-panel p-1 shadow-lg";
const item = "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none focus:bg-cu-hover data-[disabled]:opacity-50";

export function TaskContextMenu({ task, statuses, onOpen, onRename, children }: {
  task: Pick<TaskWithRelations, "id" | "listId" | "name" | "priority" | "archived"> & { status: Pick<StatusModel, "id" | "type"> };
  statuses?: StatusModel[];
  onOpen: () => void;
  onRename?: () => void;
  children: ReactElement;
}) {
  const update = useUpdateTask(task.listId);
  const duplicate = useDuplicateTask(task.listId);
  const trash = useDeleteTask(task.listId);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["task-menu-statuses", task.listId],
    queryFn: () => apiGet<StatusModel[]>(`/api/lists/${task.listId}/statuses`),
    enabled: open && !statuses,
  });
  const choices = statuses ?? query.data ?? [];
  const target = quickStatus<Pick<StatusModel, "id" | "type">>(task.status, choices);
  const { currentUser, workspace } = useWorkspace();
  const canWrite = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");

  function change(patch: Parameters<typeof update.mutate>[0]["patch"], message = "") {
    update.mutate({ taskId: task.id, patch }, {
      onSuccess: () => setNotice(message),
      onError: () => setNotice("Could not update task."),
    });
  }

  async function copyLink() {
    const url = new URL(`/l/${task.listId}`, window.location.origin);
    url.searchParams.set("task", task.id);
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice("Task link copied.");
    } catch {
      setNotice("Could not copy the task link.");
    }
  }

  return (
    <ContextMenu.Root onOpenChange={setOpen}>
      <ContextMenu.Trigger asChild onContextMenu={(event) => event.stopPropagation()}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={panel} onClick={(event) => event.stopPropagation()}>
          <ContextMenu.Item className={item} onSelect={onOpen}>Open task</ContextMenu.Item>
          {canWrite && <>{onRename && <ContextMenu.Item className={item} onSelect={onRename}>Rename</ContextMenu.Item>}
          {target && (
            <ContextMenu.Item className={item} onSelect={() => change({ statusId: target.id })}>
              {isCompletedStatus(task.status.type) ? "Reopen task" : "Close task"}
            </ContextMenu.Item>
          )}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={item}>Change status <span className="ml-auto">›</span></ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={panel}>
                {choices.map((status) => (
                  <ContextMenu.Item key={status.id} className={item} disabled={status.id === task.status.id} onSelect={() => change({ statusId: status.id })}>
                    <StatusCircle status={status} size={14} /> {status.name}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={item}>Set priority <span className="ml-auto">›</span></ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={panel}>
                {PRIORITY_ORDER.map((priority) => (
                  <ContextMenu.Item key={priority} className={item} disabled={priority === task.priority} onSelect={() => change({ priority })}>
                    {PRIORITY_CONFIG[priority].label}
                  </ContextMenu.Item>
                ))}
                <ContextMenu.Item className={item} disabled={!task.priority} onSelect={() => change({ priority: null })}>Clear priority</ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={item}>Set due date <span className="ml-auto">›</span></ContextMenu.SubTrigger>
            <ContextMenu.Portal><ContextMenu.SubContent className={panel}>
              {["Today", "Tomorrow", "Next week"].map((label, index) => <ContextMenu.Item key={label} className={item} onSelect={() => {
                const date = new Date();
                date.setDate(date.getDate() + [0, 1, 7][index]);
                date.setHours(12, 0, 0, 0);
                change({ dueDate: date.toISOString() });
              }}>{label}</ContextMenu.Item>)}
              <ContextMenu.Item className={item} onSelect={() => change({ dueDate: null })}>Clear due date</ContextMenu.Item>
            </ContextMenu.SubContent></ContextMenu.Portal>
          </ContextMenu.Sub>
          </>}
          <ContextMenu.Separator className="my-1 border-t border-cu-border" />
          <ContextMenu.Item className={item} onSelect={() => void copyLink()}>Copy task link</ContextMenu.Item>
          {canWrite && <><ContextMenu.Item className={item} onSelect={() => duplicate.mutate(task.id, { onError: () => setNotice("Could not duplicate task.") })}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item className={item} onSelect={() => change({ archived: !task.archived })}>{task.archived ? "Unarchive task" : "Archive task"}</ContextMenu.Item>
          <ContextMenu.Item className={item + " text-cu-urgent"} onSelect={() => trash.mutate(task.id, { onError: () => setNotice("Could not move the task to Trash.") })}>Move to Trash</ContextMenu.Item></>}
        </ContextMenu.Content>
      </ContextMenu.Portal>
      {notice && <span role="status" className="sr-only">{notice}</span>}
    </ContextMenu.Root>
  );
}
