"use client";

import { cloneElement, useState, type MouseEvent, type ReactElement } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { ViewSharing } from "@/components/views/view-sharing";
import { apiSend } from "@/lib/api";
import type { ListWithMeta } from "@/lib/queries";

type View = Omit<ListWithMeta["views"][number], "listId"> & { listId?: string };
const button = "rounded border border-cu-border px-2 py-1 text-sm hover:bg-cu-hover disabled:opacity-50";

export function ViewOptions({ view, allowDelete, selectView, tab, active, canEdit, isDefault, canManage, canShare, locationHref, apiBase = "/api/views" }: { view: View; allowDelete: boolean; selectView: (view: View | null) => void; tab: ReactElement<{ onContextMenu?: (event: MouseEvent) => void }>; active: boolean; canEdit: boolean; isDefault: boolean; canManage: boolean; canShare: boolean; locationHref?: string; apiBase?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.name);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: "rename" | "copy" | "delete" | "default" | "privacy" | "lock") => {
      const path = `${apiBase}/${view.id}`;
      if (action === "rename") return apiSend<View>(path, "PATCH", { name });
      if (action === "default") return apiSend<View>(path, "PATCH", { makeDefault: true });
      if (action === "lock") return apiSend<View>(path, "PATCH", { protected: !view.protected });
      if (action === "privacy") return apiSend<View>(path, "PATCH", { private: !view.privateOwnerId });
      if (action === "copy") return apiSend<View>(path, "POST");
      return apiSend(path, "DELETE").then(() => null);
    },
    onSuccess: async (result, action) => {
      await client.invalidateQueries({ queryKey: view.listId ? ["list", view.listId] : ["scoped-views"] });
      if (action === "copy" || action === "delete") selectView(result);
      setOpen(false);
    },
  });
  function toggle(next: boolean) {
    setOpen(next);
    if (next) { setName(view.name); setConfirm(false); setNotice(""); mutation.reset(); }
  }
  return <Popover.Root open={open} onOpenChange={toggle}>
    <Popover.Anchor asChild>{cloneElement(tab, { onContextMenu: (event) => {
      event.preventDefault();
      toggle(true);
    } })}</Popover.Anchor>
    {active && <Popover.Trigger asChild><button aria-label="Manage current view" className="rounded p-1 text-cu-text-secondary hover:bg-cu-hover"><Ellipsis className="h-4 w-4" /></button></Popover.Trigger>}
    <Popover.Portal>
      <Popover.Content align="start" className="z-50 min-w-48 rounded border border-cu-border bg-cu-panel p-3 shadow-lg">
        <button className={button + " mb-2 w-full text-left"} onClick={() => { selectView(view); setOpen(false); }}>Open view</button>
        <button className={button + " mb-2 w-full text-left"} onClick={async () => {
          const url = new URL(locationHref ?? `/l/${view.listId}`, location.origin);
          url.searchParams.set("view", view.id);
          try { await navigator.clipboard.writeText(url.href); setNotice("View link copied."); }
          catch { setNotice("Could not copy the view link."); }
        }}>Copy view link</button>
        {notice && <p role="status" className="mb-2 text-xs">{notice}</p>}
        {canEdit && !isDefault && !view.privateOwnerId && <button className={button + " mb-2 w-full text-left"} disabled={mutation.isPending} onClick={() => mutation.mutate("default")}>Set as default view</button>}
        {canManage && <button className={button + " mb-2 w-full text-left"} disabled={mutation.isPending} onClick={() => mutation.mutate("lock")}>
          {view.protected ? "Unlock view settings" : "Lock view settings"}
        </button>}
        {canEdit && (canManage || view.privateOwnerId) && <button className={button + " mb-2 w-full text-left"} disabled={mutation.isPending || (!view.privateOwnerId && !allowDelete)}
          onClick={() => mutation.mutate("privacy")}>{view.privateOwnerId ? "Share with workspace" : "Make private"}</button>}
        {canEdit && <><form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); mutation.mutate("rename"); }}>
          <label className="grid gap-1 text-sm">Current view name<input className={button} value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></label>
          <button className={button} disabled={mutation.isPending || !name.trim() || name.trim() === view.name}>Rename view</button>
        </form>
        <div className="mt-2 flex gap-2">
          <button className={button} disabled={mutation.isPending} onClick={() => mutation.mutate("copy")}>Duplicate view</button>
          {allowDelete && <button className={button + " text-cu-urgent"} disabled={mutation.isPending}
            onClick={() => confirm ? mutation.mutate("delete") : setConfirm(true)}>{confirm ? "Confirm deletion" : "Delete view"}</button>}
        </div>
        </>}
        {open && canShare && <ViewSharing viewId={view.id} isPrivate={!!view.privateOwnerId} base={apiBase}
          disclosure={view.type === "MAP" ? "Anyone with the link can see matching task names, statuses, dates, and map coordinates." : view.type === "EMBED" ? "Anyone with the link can see and open this view’s embedded website address." : undefined} />}
        {mutation.isError && <p role="alert" className="mt-2 text-sm text-cu-urgent">Could not update this view.</p>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
