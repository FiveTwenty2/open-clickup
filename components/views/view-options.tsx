"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { apiSend } from "@/lib/api";
import type { ListWithMeta } from "@/lib/queries";

type View = ListWithMeta["views"][number];
const button = "rounded border border-cu-border px-2 py-1 text-sm hover:bg-cu-hover disabled:opacity-50";

export function ViewOptions({ view, allowDelete, selectView }: { view: View; allowDelete: boolean; selectView: (view: View | null) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.name);
  const [confirm, setConfirm] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: "rename" | "copy" | "delete") => {
      const path = `/api/views/${view.id}`;
      if (action === "rename") return apiSend<View>(path, "PATCH", { name });
      if (action === "copy") return apiSend<View>(path, "POST");
      return apiSend(path, "DELETE").then(() => null);
    },
    onSuccess: async (result, action) => {
      await client.invalidateQueries({ queryKey: ["list", view.listId] });
      if (action !== "rename") selectView(result);
      setOpen(false);
    },
  });
  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setName(view.name); setConfirm(false); mutation.reset(); } }}>
    <Popover.Trigger asChild><button aria-label="Manage current view" className="rounded p-1 text-cu-text-secondary hover:bg-cu-hover"><Ellipsis className="h-4 w-4" /></button></Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="start" className="z-50 min-w-48 rounded border border-cu-border bg-cu-panel p-3 shadow-lg">
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); mutation.mutate("rename"); }}>
          <label className="grid gap-1 text-sm">Current view name<input className={button} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></label>
          <button className={button} disabled={mutation.isPending || !name.trim() || name.trim() === view.name}>Rename view</button>
        </form>
        <div className="mt-2 flex gap-2">
          <button className={button} disabled={mutation.isPending} onClick={() => mutation.mutate("copy")}>Duplicate view</button>
          {allowDelete && <button className={button + " text-cu-urgent"} disabled={mutation.isPending}
            onClick={() => confirm ? mutation.mutate("delete") : setConfirm(true)}>{confirm ? "Confirm deletion" : "Delete view"}</button>}
        </div>
        {mutation.isError && <p role="alert" className="mt-2 text-sm text-cu-urgent">Could not update this view.</p>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
