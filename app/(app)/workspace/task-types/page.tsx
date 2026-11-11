"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import { useTaskTypes, type TaskType } from "@/components/task/task-type-control";

const input = "rounded border border-cu-border bg-cu-panel px-3 py-1.5 text-sm disabled:opacity-50";
const defaultColor = "#7b68ee";
type Action = { method: "POST" | "PATCH" | "DELETE"; data: Partial<TaskType> };

export default function TaskTypesPage() {
  const { workspace, currentUser } = useWorkspace();
  const role = workspace.members.find((member) => member.userId === currentUser.id)?.role;
  const allowed = role === "OWNER" || role === "ADMIN";
  const types = useTaskTypes();
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);
  const [confirm, setConfirm] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ method, data }: Action) => apiSend("/api/workspace/task-types", method, data),
    onSuccess: () => {
      setEditing(null); setName(""); setColor(defaultColor); setConfirm(null);
      void client.invalidateQueries({ queryKey: ["task-types"] });
      void client.invalidateQueries({ queryKey: ["list"] });
      void client.invalidateQueries({ queryKey: ["task"] });
    },
  });
  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <Link href="/workspace" className="text-sm text-cu-purple hover:underline">Workspace settings</Link>
    <h1 className="mb-4 mt-2 text-xl font-semibold">Task types</h1>
    {types.isPending && <p>Loading task types…</p>}
    {types.isError && <p role="alert">Could not load task types.</p>}
    <ul className="mb-5 max-w-xl divide-y divide-cu-border">
      {types.data?.map((type) => <li key={type.id} className="flex flex-wrap items-center gap-2 py-2">
        <span className="mr-auto flex items-center gap-2 text-sm"><span className="h-3 w-3 rounded-full" style={{ background: type.color }} />{type.name}</span>
        {allowed && <>
          <button className={input} disabled={mutation.isPending} onClick={() => {
            mutation.reset(); setEditing(type.id); setName(type.name); setColor(type.color); setConfirm(null);
          }}>Edit {type.name}</button>
          <button className={input} disabled={mutation.isPending} onClick={() => {
            if (confirm === type.id) mutation.mutate({ method: "DELETE", data: { id: type.id } });
            else setConfirm(type.id);
          }}>{confirm === type.id ? "Confirm deletion and reset affected tasks" : `Delete ${type.name}`}</button>
        </>}
      </li>)}
    </ul>
    {allowed && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (name.trim() && !mutation.isPending) mutation.mutate({ method: editing ? "PATCH" : "POST", data: { id: editing ?? undefined, name, color } });
    }}>
      <label className="grid gap-1 text-xs">Type name<input className={input} required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="grid gap-1 text-xs">Type color<input className={input + " h-9 w-16"} type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      <button className={input} disabled={!name.trim() || mutation.isPending}>{editing ? "Save task type" : "Create task type"}</button>
      {editing && <button type="button" className={input} onClick={() => { setEditing(null); setName(""); setColor(defaultColor); }}>Cancel</button>}
    </form>}
    {mutation.isError && <p role="alert" className="mt-3 text-sm text-cu-urgent">Could not save the task type. Check that the name is unique.</p>}
  </main>;
}
