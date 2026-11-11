"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";

const button = "rounded border border-cu-border px-2 py-1 text-xs hover:bg-cu-hover disabled:opacity-50";
export function PublicTaskShare({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const api = `/api/tasks/${taskId}/public-share`;
  const query = useQuery({ queryKey: ["public-task-share", taskId], queryFn: () => apiGet<{ key: string | null }>(api), enabled: open });
  const change = useMutation({
    mutationFn: (enable: boolean) => apiSend(api, enable ? "POST" : "DELETE"),
    onSuccess: () => query.refetch(),
  });
  const key = query.data?.key;
  const url = key && typeof window !== "undefined" ? new URL(`/shared-task/${key}`, window.location.origin).href : null;
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); setNotice(""); }}>
    <Popover.Trigger className={button}>Share task summary</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" className="z-[70] w-72 space-y-2 rounded border border-cu-border bg-cu-panel p-3 shadow">
        <p className="text-xs">Anyone with the link can see the task name, status, priority, and dates.</p>
        {query.isPending && <p role="status" className="text-xs">Loading…</p>}
        {(query.isError || change.isError) && <p role="alert" className="text-xs text-cu-urgent">Could not update sharing.</p>}
        {query.data && !url && <button className={button} disabled={change.isPending} onClick={() => change.mutate(true)}>Enable public link</button>}
        {url && <>
          <input className="w-full rounded border border-cu-border px-2 py-1 text-xs" aria-label="Public task link" readOnly value={url} />
          <div className="flex gap-2">
            <button className={button} onClick={async () => {
              try { await navigator.clipboard.writeText(url); setNotice("Copied."); }
              catch { setNotice("Select the link to copy it."); }
            }}>Copy link</button>
            <button className={button} disabled={change.isPending} onClick={() => { setNotice(""); change.mutate(false); }}>Revoke link</button>
          </div>
        </>}
        {notice && <p role="status" className="text-xs">{notice}</p>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
