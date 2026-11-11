"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";

type Placement = { id: string; name: string; archivedAt: string | null; inherited: boolean };
const button = "rounded border border-cu-border px-2 py-1 text-xs hover:bg-cu-hover disabled:opacity-50";

export function TaskLists({ taskId, homeListId, canEdit }: { taskId: string; homeListId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const path = `/api/tasks/${taskId}/lists`;
  const key = ["task-list-memberships", taskId];
  const query = useQuery({ queryKey: key, queryFn: () => apiGet<Placement[]>(path), enabled: open });
  const change = useMutation({
    mutationFn: ({ listId, add }: { listId: string; add: boolean }) => apiSend(path, add ? "POST" : "DELETE", { listId }),
    onSuccess: async (_result, { listId }) => {
      setDestination("");
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ["list", listId] }),
        client.invalidateQueries({ queryKey: ["task", taskId] }),
      ]);
    },
  });
  const existing = new Set(query.data?.filter(({ inherited }) => !inherited).map(({ id }) => id));
  const options = workspace.spaces.flatMap((space) => [
    ...space.lists.map((list) => ({ id: list.id, label: `${space.name} / ${list.name}` })),
    ...space.folders.flatMap((folder) => folder.lists.map((list) => ({ id: list.id, label: `${space.name} / ${folder.name} / ${list.name}` }))),
  ]).filter(({ id }) => id !== homeListId && !existing.has(id));
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger className={button}>Task lists</Popover.Trigger>
    <Popover.Portal><Popover.Content className="z-[70] w-80 space-y-2 rounded border border-cu-border bg-cu-panel p-3 shadow">
      <h3 className="text-sm font-semibold">Additional lists</h3>
      {query.isPending && <p role="status" className="text-xs">Loading lists…</p>}
      {query.data?.length === 0 && <p className="text-xs text-cu-text-secondary">This task is only in its home list.</p>}
      {query.data?.map((list) => <div key={list.id} className="flex items-center justify-between gap-2 text-xs">
        <a className="truncate hover:underline" href={`/l/${list.id}?task=${taskId}`}>{list.name}{list.archivedAt ? " (archived)" : list.inherited ? " (via parent)" : ""}</a>
        {canEdit && !list.inherited && <button className={button} aria-label={`Remove from ${list.name}`} disabled={change.isPending}
          onClick={() => change.mutate({ listId: list.id, add: false })}>Remove</button>}
      </div>)}
      {canEdit && query.data && <form className="grid gap-2" onSubmit={(event) => {
        event.preventDefault(); if (destination) change.mutate({ listId: destination, add: true });
      }}>
        <label className="grid gap-1 text-xs">Add to list
          <select className={button + " bg-cu-panel"} value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="">Choose a list</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <button className={button} disabled={!destination || change.isPending}>Add to list</button>
      </form>}
      {(query.isError || change.isError) && <p role="alert" className="text-xs text-cu-urgent">Could not update task lists.</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
