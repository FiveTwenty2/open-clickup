"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet, apiSend } from "@/lib/api";

export type ListTemplateTarget = { sourceListId: string } | { spaceId: string; folderId?: string };
type Template = { id: string; name: string; updatedAt: string };
const control = "rounded border border-cu-border bg-cu-panel px-3 py-2 text-sm disabled:opacity-50";

export function ListTemplatesDialog({ target, onClose }: { target: ListTemplateTarget; onClose: () => void }) {
  const { currentUser, workspace } = useWorkspace();
  const canCopyRules = workspace.members.some((member) => member.userId === currentUser.id && (member.role === "ADMIN" || member.role === "OWNER"));
  const fromList = "sourceListId" in target;
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [includeTasks, setIncludeTasks] = useState(true);
  const [includeAutomations, setIncludeAutomations] = useState(false);
  const [includeDates, setIncludeDates] = useState(false);
  const query = useQuery({ queryKey: ["list-templates"], queryFn: () => apiGet<Template[]>("/api/list-templates") });
  const client = useQueryClient();
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: () => {
      if ("sourceListId" in target) return apiSend("/api/list-templates", selected ? "PATCH" : "POST", {
        ...target, id: selected || undefined, name, includeTasks,
      });
      return apiSend<{ id: string }>("/api/list-templates", "PUT", {
        ...target, templateId: selected, name, includeTasks, includeDates: includeTasks && includeDates, includeAutomations,
      });
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: [fromList ? "list-templates" : "bootstrap"] });
      if (!fromList && result && typeof result === "object" && "id" in result) router.push(`/l/${result.id}`);
      onClose();
    },
  });
  function select(id: string) {
    setSelected(id);
    setName(query.data?.find((template) => template.id === id)?.name ?? "");
    mutation.reset();
  }
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/40" />
      <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-[71] w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded border border-cu-border bg-cu-panel p-5 shadow-xl">
        <Dialog.Title className="mb-4 text-base font-semibold">{fromList ? "Save or update a list template" : "Create list from template"}</Dialog.Title>
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); if (name.trim() && (fromList || selected)) mutation.mutate(); }}>
          <label className="grid gap-1 text-sm">List template
            <select aria-label="List template" className={control} value={selected} onChange={(event) => select(event.target.value)} disabled={query.isPending}>
              <option value="">{fromList ? "New template" : "Choose a template"}</option>
              {query.data?.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          {query.isError && <p role="alert" className="text-xs text-cu-urgent">Could not load templates.</p>}
          {!fromList && query.data?.length === 0 && <p className="text-sm text-cu-text-secondary">Save a template from an existing list first.</p>}
          <label className="grid gap-1 text-sm">{fromList ? "Template name" : "New list name"}
            <input className={control} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeTasks} onChange={(event) => setIncludeTasks(event.target.checked)} /> Include tasks, subtasks, and checklists</label>
          {!fromList && includeTasks && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeDates} onChange={(event) => setIncludeDates(event.target.checked)} /> Keep original task dates
          </label>}
          {!fromList && canCopyRules && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeAutomations}
            onChange={(event) => setIncludeAutomations(event.target.checked)} /> Copy automation rules</label>}
          {fromList && selected && <p className="text-xs text-cu-text-secondary">This replaces the saved template with the current list.</p>}
          {mutation.isError && <p role="alert" className="text-sm text-cu-urgent">Could not save the template or create the list. Check the name and try again.</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild><button type="button" className={control} disabled={mutation.isPending}>Cancel</button></Dialog.Close>
            <button className={control + " bg-cu-purple text-white"} disabled={mutation.isPending || !name.trim() || (!fromList && !selected)}>
              {fromList ? selected ? "Update template" : "Save template" : "Create list"}
            </button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
