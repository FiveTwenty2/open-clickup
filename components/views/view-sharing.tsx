"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";

type Sharing = { private: boolean; readers: string[]; key: string | null };
type Action = { action: "readers"; userIds: string[] } | { action: "enable" | "revoke" };
const button = "rounded border border-cu-border px-2 py-1 text-xs hover:bg-cu-hover disabled:opacity-50";

export function ViewSharing({ viewId, isPrivate }: { viewId: string; isPrivate: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const { workspace, currentUser } = useWorkspace();
  const url = `/api/views/${viewId}/sharing`;
  const query = useQuery({
    queryKey: ["view-sharing", viewId], queryFn: () => apiGet<Sharing>(url), enabled: expanded,
  });
  const mutation = useMutation({
    mutationFn: (action: Action) => apiSend(url, "PATCH", action),
    onSuccess: async () => { await query.refetch(); setSelected(null); },
  });
  const readers = selected ?? query.data?.readers ?? [];
  const publicUrl = query.data?.key && typeof window !== "undefined"
    ? new URL(`/shared-view/${query.data.key}`, window.location.origin).href : null;
  return <div className="mt-3 border-t border-cu-border pt-2">
    <button className={button} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {isPrivate ? "Share with teammates" : "Public view link"}
    </button>
    {expanded && <div className="mt-2 space-y-2">
      {query.isPending && <p role="status" className="text-xs">Loading sharing settings…</p>}
      {query.data && isPrivate && <>
        <p className="text-xs text-cu-text-secondary">Selected teammates can open the view. Only you can change its saved settings.</p>
        <fieldset disabled={mutation.isPending} className="max-h-32 space-y-1 overflow-auto">
          <legend className="sr-only">Teammates with view access</legend>
          {workspace.members.filter(({ user }) => user.id !== currentUser.id).map(({ user }) => <label key={user.id} className="flex gap-2 text-xs">
            <input type="checkbox" checked={readers.includes(user.id)} onChange={(event) => setSelected(
              event.target.checked ? [...readers, user.id] : readers.filter((id) => id !== user.id),
            )} />
            {user.name}
          </label>)}
        </fieldset>
        <button className={button} disabled={!selected || mutation.isPending} onClick={() => mutation.mutate({ action: "readers", userIds: readers })}>
          Save view access
        </button>
      </>}
      {query.data && !isPrivate && <>
        <p className="text-xs text-cu-text-secondary">Anyone with the link can see the matching task names, statuses, priorities, and dates.</p>
        {publicUrl ? <>
          <input aria-label="Public view URL" className="w-full rounded border border-cu-border bg-cu-panel px-2 py-1 text-xs" value={publicUrl} readOnly onFocus={(event) => event.target.select()} />
          <button className={button} disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "revoke" })}>Revoke public view link</button>
        </> : <button className={button} disabled={mutation.isPending} onClick={() => mutation.mutate({ action: "enable" })}>Enable public view link</button>}
      </>}
      {(query.isError || mutation.isError) && <p role="alert" className="text-xs text-cu-urgent">Could not update view sharing.</p>}
    </div>}
  </div>;
}
