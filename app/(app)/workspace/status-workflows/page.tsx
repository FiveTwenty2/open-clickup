"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet, apiSend } from "@/lib/api";
import type { StatusWorkflow } from "@/lib/status-workflows";

type Location = { key: string; label: string; kind: "space" | "folder" | "list" };
type Response = { inherited: boolean; source: string; workflow: StatusWorkflow };
const field = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm disabled:opacity-50";
const kinds = ["NOT_STARTED", "ACTIVE", "DONE", "CLOSED"] as const;

export default function StatusWorkflowsPage() {
  const { workspace, currentUser } = useWorkspace();
  const admin = workspace.members.some((member) => member.userId === currentUser.id && (member.role === "OWNER" || member.role === "ADMIN"));
  const member = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const locations = workspace.spaces.flatMap<Location>((space) => [
    { key: `space/${space.id}`, label: space.name, kind: "space" },
    ...space.lists.map((list): Location => ({ key: `list/${list.id}`, label: `${space.name} / ${list.name}`, kind: "list" })),
    ...space.folders.flatMap((folder): Location[] => [
      { key: `folder/${folder.id}`, label: `${space.name} / ${folder.name}`, kind: "folder" },
      ...folder.lists.map((list): Location => ({ key: `list/${list.id}`, label: `${space.name} / ${folder.name} / ${list.name}`, kind: "list" })),
    ]),
  ]);
  const [choice, setChoice] = useState("");
  const selected = locations.find((location) => location.key === choice) ?? locations[0];
  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <h1 className="mb-4 text-xl font-semibold">Status workflows</h1>
    <label className="grid max-w-xl gap-1 text-xs">Location
      <select aria-label="Workflow location" className={field} value={selected?.key ?? ""} onChange={(event) => setChoice(event.target.value)}>
        {locations.map((location) => <option key={location.key} value={location.key}>{location.kind} · {location.label}</option>)}
      </select>
    </label>
    {selected && <WorkflowEditor key={selected.key} location={selected} canEdit={selected.kind === "list" ? member : admin} />}
  </main>;
}

function WorkflowEditor({ location, canEdit }: { location: Location; canEdit: boolean }) {
  const [draft, setDraft] = useState<StatusWorkflow | null>(null);
  const client = useQueryClient();
  const queryKey = ["status-workflow", location.key];
  const path = "/api/status-workflows/" + location.key;
  const query = useQuery({ queryKey, queryFn: () => apiGet<Response>(path) });
  const save = useMutation({
    mutationFn: (workflow: StatusWorkflow | null) => apiSend(path, "PUT", { workflow }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey }), client.invalidateQueries({ queryKey: ["list"] })]);
      setDraft(null);
    },
  });
  const rows = draft ?? query.data?.workflow ?? [];
  const update = (index: number, patch: Partial<StatusWorkflow[number]>) =>
    setDraft(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const move = (index: number, offset: -1 | 1) => {
    const next = [...rows];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setDraft(next);
  };
  return <section className="mt-5 max-w-2xl">
    {query.isPending && <p role="status">Loading workflow…</p>}
    {query.isError && <p role="alert">Could not load this workflow.</p>}
    {query.data && <>
      <p className="mb-3 text-sm text-cu-text-secondary">{query.data.inherited ? `Inherits from ${query.data.source}` : "This location uses its own statuses."}</p>
      <fieldset disabled={!canEdit || save.isPending} className="space-y-2">
        {rows.map((row, i) => <div key={row.key} className="flex flex-wrap gap-2">
          <input aria-label={`Status ${i + 1} name`} className={field + " flex-1"} value={row.name} maxLength={80} onChange={(event) => update(i, { name: event.target.value })} />
          <input aria-label={`Status ${i + 1} color`} className={field + " h-9 w-14"} type="color" value={row.color} onChange={(event) => update(i, { color: event.target.value })} />
          <select aria-label={`Status ${i + 1} category`} className={field} value={row.type} onChange={(event) => update(i, { type: event.target.value as typeof row.type })}>
            {kinds.map((kind) => <option key={kind}>{kind}</option>)}
          </select>
          <button className={field} aria-label={`Move status ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className={field} aria-label={`Move status ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button className={field} aria-label={`Remove status ${i + 1}`} disabled={rows.length === 1} onClick={() => setDraft(rows.filter((_, index) => index !== i))}>Remove</button>
        </div>)}
        {canEdit && <div className="flex flex-wrap gap-2 pt-2">
          <button className={field} disabled={rows.length >= 100} onClick={() => setDraft([...rows, { key: crypto.randomUUID(), name: "", color: "#87909e", type: "ACTIVE" }])}>Add status</button>
          <button className={field} disabled={!draft || rows.some((row) => !row.name.trim())} onClick={() => save.mutate(rows)}>Save workflow</button>
          {draft && <button className={field} onClick={() => setDraft(null)}>Cancel edits</button>}
          {!query.data.inherited && <button className={field} onClick={() => save.mutate(null)}>{location.kind === "space" ? "Restore default workflow" : "Use inherited statuses"}</button>}
        </div>}
      </fieldset>
      {save.isError && <p role="alert" className="mt-2 text-sm text-cu-urgent">Could not save the workflow. Use unique names and keep at least one open status.</p>}
    </>}
  </section>;
}
