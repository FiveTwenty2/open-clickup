"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet } from "@/lib/api";

type Entry = {
  id: string; createdAt: string; type: string; data: Record<string, unknown> | null;
  user: { name: string } | null;
  task: { id: string; listId: string; name: string; deletedAt: string | null };
};
const actionLabels: Record<string, string> = {
  archived: "Archived", unarchived: "Unarchived", trashed: "Moved to Trash", restored: "Restored from Trash",
  commented: "Posted a comment", comment_edited: "Edited a comment", comment_deleted: "Deleted a comment",
  comment_resolved: "Resolved a comment", comment_reopened: "Reopened a comment", bulk_updated: "Bulk updated",
};
const control = "rounded border border-cu-border bg-cu-panel px-3 py-1.5 text-sm disabled:opacity-50";

export default function AuditPage() {
  const { workspace, currentUser } = useWorkspace();
  const role = workspace.members.find((member) => member.userId === currentUser.id)?.role;
  const allowed = role === "OWNER" || role === "ADMIN";
  const [page, setPage] = useState(0);
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const params = new URLSearchParams({ page: String(page), actor, action, q: search });
  const query = useQuery({
    queryKey: ["audit", params.toString()],
    queryFn: () => apiGet<{ entries: Entry[]; hasNext: boolean }>(`/api/audit?${params}`),
    enabled: allowed,
  });
  return (
    <main className="flex-1 overflow-auto p-5 sm:p-8">
      <h1 className="mb-4 text-xl font-semibold">Task audit log</h1>
      {!allowed ? <p>Only workspace owners and admins can view the audit log.</p> : <>
        <div className="mb-4 flex flex-wrap gap-2">
          <input className={control} aria-label="Search by task name" placeholder="Search by task name" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          <select className={control} aria-label="Audit action" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
            <option value="">All actions</option><option value="recovery">Archive and Trash</option><option value="discussion">Comments</option>
          </select>
          <select className={control} aria-label="Audit actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(0); }}>
            <option value="">All people</option>
            {workspace.members.map(({ user }) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </div>
        {query.isPending && <p>Loading audit log…</p>}
        {query.isError && <p role="alert">Could not load the audit log.</p>}
        {query.data?.entries.length === 0 && <p>No matching activity.</p>}
        <ul className="divide-y divide-cu-border">
          {query.data?.entries.map((entry) => (
            <li key={entry.id} className="py-3 text-sm">
              <p><strong>{entry.user?.name ?? "System"}</strong> · {actionLabels[entry.type] ?? entry.type.replaceAll("_", " ")} · {entry.task.deletedAt ? entry.task.name : (
                <Link href={`/l/${entry.task.listId}?task=${entry.task.id}`} className="text-cu-purple hover:underline">{entry.task.name}</Link>
              )}</p>
              <time className="text-xs text-cu-text-secondary" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              {entry.data && Object.keys(entry.data).length > 0 && <details className="mt-1">
                <summary className="cursor-pointer text-xs text-cu-text-secondary">Change details</summary>
                <pre className="whitespace-pre-wrap break-all rounded bg-cu-hover p-2 text-xs">{JSON.stringify(entry.data, null, 2)}</pre>
              </details>}
            </li>
          ))}
        </ul>
        {(page > 0 || query.data?.hasNext) && <div className="mt-4 flex gap-2">
          <button className={control} disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
          <button className={control} disabled={!query.data?.hasNext} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </>}
    </main>
  );
}
