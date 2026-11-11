"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";

type Related = { id: string; task: { id: string; name: string; listId: string } };
type Resource = { id: string; title: string; url: string };
type SearchResult = { tasks: { id: string; name: string; list: { name: string } }[] };
type Addition = { kind: "task"; otherId: string } | { kind: "link"; title: string; url: string };
const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-xs disabled:opacity-50";

export function Relationships({ taskId }: { taskId: string }) {
  const { workspace, currentUser } = useWorkspace();
  const canWrite = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const path = `/api/tasks/${taskId}/relationships`;
  const key = ["relationships", taskId];
  const client = useQueryClient();
  const [mode, setMode] = useState<"task" | "link" | null>(null);
  const [term, setTerm] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const query = useQuery({ queryKey: key, queryFn: () => apiGet<{ related: Related[]; links: Resource[] }>(path) });
  const search = useQuery({
    queryKey: ["relationship-search", term.trim()],
    queryFn: () => apiGet<SearchResult>(`/api/search?q=${encodeURIComponent(term.trim())}`),
    enabled: mode === "task" && term.trim().length >= 2,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["relationships"] });
    void client.invalidateQueries({ queryKey: ["task", taskId] });
  };
  const add = useMutation({
    mutationFn: (data: Addition) => apiSend(path, "POST", data),
    onSuccess: () => {
      setMode(null); setTerm(""); setTitle(""); setUrl(""); refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (data: { kind: "task" | "link"; id: string }) => apiSend(path, "DELETE", data),
    onSuccess: refresh,
  });
  const linked = new Set(query.data?.related.map(({ task }) => task.id));
  const available = search.data?.tasks.filter((task) => task.id !== taskId && !linked.has(task.id));
  function toggle(next: "task" | "link") {
    setMode(mode === next ? null : next);
    add.reset();
  }
  return <section className="mt-6" aria-label="Relationships">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-[13px] font-semibold text-cu-text-secondary">Relationships</h3>
      {canWrite && <>
        <button className={control} onClick={() => toggle("task")} aria-expanded={mode === "task"}>Link task</button>
        <button className={control} onClick={() => toggle("link")} aria-expanded={mode === "link"}>Add web link</button>
      </>}
    </div>
    {query.isPending && <p className="mt-2 text-xs">Loading relationships…</p>}
    {query.isError && <p role="alert" className="mt-2 text-xs text-cu-urgent">Could not load relationships.</p>}
    {query.data?.related.length === 0 && query.data.links.length === 0 && <p className="mt-2 text-xs text-cu-text-tertiary">No related tasks or links.</p>}
    <ul className="divide-y divide-cu-border">
      {query.data?.related.map(({ id, task }) => <li key={id} className="flex items-center gap-2 py-2 text-sm">
        <Link className="min-w-0 flex-1 truncate text-cu-purple hover:underline" href={`/l/${task.listId}?task=${task.id}`}>{task.name}</Link>
        {canWrite && <button aria-label={`Unlink ${task.name}`} className={control} disabled={remove.isPending} onClick={() => remove.mutate({ kind: "task", id })}>Remove</button>}
      </li>)}
      {query.data?.links.map((link) => <li key={link.id} className="flex items-center gap-2 py-2 text-sm">
        <a className="min-w-0 flex-1 truncate text-cu-purple hover:underline" href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a>
        {canWrite && <button aria-label={`Remove link ${link.title}`} className={control} disabled={remove.isPending} onClick={() => remove.mutate({ kind: "link", id: link.id })}>Remove</button>}
      </li>)}
    </ul>
    {mode === "task" && <div className="mt-2 space-y-1">
      <input className={control + " w-full"} aria-label="Find related task" placeholder="Search tasks" value={term} onChange={(event) => setTerm(event.target.value)} />
      {search.isError && <p role="alert" className="text-xs">Could not search tasks.</p>}
      {term.trim().length >= 2 && available?.length === 0 && <p className="text-xs text-cu-text-secondary">No matching tasks.</p>}
      {available?.map((task) => <button key={task.id} className={control + " block w-full text-left hover:bg-cu-hover"}
        disabled={add.isPending} onClick={() => add.mutate({ kind: "task", otherId: task.id })}>{task.name} · {task.list.name}</button>)}
    </div>}
    {mode === "link" && <form className="mt-2 grid gap-2" onSubmit={(event) => {
      event.preventDefault();
      add.mutate({ kind: "link", title: title.trim(), url: url.trim() });
    }}>
      <input className={control} aria-label="Link label" placeholder="Link label" required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} />
      <input className={control} aria-label="Web address" placeholder="https://" type="url" required maxLength={2000}
        pattern="https?://.*" value={url} onChange={(event) => setUrl(event.target.value)} />
      <button className={control + " justify-self-start"} disabled={add.isPending || !title.trim()}>Save link</button>
    </form>}
    {(add.isError || remove.isError) && <p role="alert" className="mt-2 text-xs text-cu-urgent">Could not update this relationship.</p>}
  </section>;
}
