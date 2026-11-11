"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import type { TaskAutomation } from "@/lib/generated/prisma/client";
import type { StatusModel } from "@/lib/queries";

const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm disabled:opacity-50";

export function AutomationDialog({ listId, statuses, onClose }: { listId: string; statuses: StatusModel[]; onClose: () => void }) {
  const { workspace, currentUser } = useWorkspace();
  const editable = workspace.members.some((member) => member.userId === currentUser.id && ["ADMIN", "OWNER"].includes(member.role));
  const [trigger, setTrigger] = useState("CREATED");
  const [confirm, setConfirm] = useState<string>();
  const client = useQueryClient();
  const path = `/api/lists/${listId}/automations`;
  const queryKey = ["automations", listId];
  const list = useQuery({ queryKey, queryFn: () => apiGet<TaskAutomation[]>(path) });
  const edit = useMutation({
    mutationFn: ({ method, body }: { method: "POST" | "PATCH" | "DELETE"; body: unknown }) => apiSend(path, method, body),
    onSuccess: () => { setConfirm(undefined); void client.invalidateQueries({ queryKey }); },
  });

  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[51] max-h-[85vh] w-[min(620px,95vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg bg-cu-panel p-5 shadow-xl">
        <div className="flex justify-between gap-2"><Dialog.Title className="text-lg font-semibold">List automations</Dialog.Title><Dialog.Close className={control}>Close</Dialog.Close></div>
        <Dialog.Description className="my-3 text-sm text-cu-text-secondary">Run a rule when a task is created or enters a selected status. Rules can set priority, assign a member, or fill in a missing due date.</Dialog.Description>
        {editable && <form className="grid gap-3 rounded border border-cu-border p-3" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          const due = String(fields.get("dueDays") ?? "");
          const priority = String(fields.get("priority") ?? "");
          const assigneeId = String(fields.get("assigneeId") ?? "");
          edit.mutate({ method: "POST", body: {
            name: String(fields.get("name")), trigger, statusId: fields.get("statusId") ?? undefined,
            priority: priority || undefined, dueDays: due === "" ? undefined : Number(due), assigneeId: assigneeId || undefined,
          } }, { onSuccess: () => { form.reset(); setTrigger("CREATED"); } });
        }}>
          <label className="grid gap-1 text-xs">Rule name<input className={control} name="name" maxLength={120} required /></label>
          <label className="grid gap-1 text-xs">When<select className={control} aria-label="Automation trigger" value={trigger} onChange={(event) => setTrigger(event.target.value)}>
            <option value="CREATED">A task is created</option><option value="STATUS_CHANGED">A task enters a status</option>
          </select></label>
          {trigger === "STATUS_CHANGED" && <label className="grid gap-1 text-xs">Status<select name="statusId" className={control} required>
            {statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
          </select></label>}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-xs">Set priority<select className={control} name="priority">
              <option value="">Leave as is</option><option value="URGENT">Urgent</option><option value="HIGH">High</option><option value="NORMAL">Normal</option><option value="LOW">Low</option>
            </select></label>
            <label className="grid gap-1 text-xs">Add assignee<select className={control} name="assigneeId">
              <option value="">Nobody</option>{workspace.members.map(({ user }) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select></label>
            <label className="grid gap-1 text-xs">Due in days<input className={control} name="dueDays" type="number" min={0} max={365} /></label>
          </div>
          <button className={control} disabled={edit.isPending}>Create rule</button>
        </form>}
        {(list.isError || edit.isError) && <p role="alert" className="my-2 text-sm text-cu-urgent">Could not complete the rule request. Choose at least one action and check your access.</p>}
        <ul className="mt-3 divide-y divide-cu-border">{list.data?.map((rule) => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div><p className="font-medium">{rule.name}</p><p className="text-xs text-cu-text-secondary">
            {rule.trigger === "CREATED" ? "On task creation" : `On entering ${statuses.find((status) => status.id === rule.statusId)?.name ?? "a removed status"}`} · {rule.enabled ? "On" : "Off"}
          </p></div>
          {editable && <div className="flex gap-2">
            <button className={control} disabled={edit.isPending} onClick={() => edit.mutate({ method: "PATCH", body: { id: rule.id, enabled: !rule.enabled } })}>{rule.enabled ? "Disable rule" : "Enable rule"}</button>
            <button className={control} disabled={edit.isPending} onClick={() => confirm === rule.id ? edit.mutate({ method: "DELETE", body: { id: rule.id } }) : setConfirm(rule.id)}>{confirm === rule.id ? "Confirm deletion" : "Delete rule"}</button>
          </div>}
        </li>)}</ul>
        {list.data?.length === 0 && <p className="text-sm text-cu-text-secondary">No rules in this list.</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
