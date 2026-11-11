"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet, apiSend } from "@/lib/api";

type EditableRole = "ADMIN" | "MEMBER" | "GUEST";
type Invitation = { id: string; email: string; role: EditableRole; expiresAt: string };
const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm disabled:opacity-50";

export default function WorkspacePage() {
  const { workspace, currentUser } = useWorkspace();
  const actor = workspace.members.find((member) => member.userId === currentUser.id);
  const owner = actor?.role === "OWNER";
  const admin = owner || actor?.role === "ADMIN";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<EditableRole>("MEMBER");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const client = useQueryClient();
  const invitations = useQuery({
    queryKey: ["invitations"], enabled: admin,
    queryFn: () => apiGet<Invitation[]>("/api/workspace/invitations"),
  });
  const create = useMutation({
    mutationFn: () => apiSend<Invitation & { path: string }>("/api/workspace/invitations", "POST", { email, role }),
    onSuccess: (result) => {
      setInviteLink(new URL(result.path, window.location.origin).href);
      setEmail("");
      setCopied(false);
      void client.invalidateQueries({ queryKey: ["invitations"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiSend("/api/workspace/invitations", "DELETE", { id }),
    onSuccess: () => { setInviteLink(""); void client.invalidateQueries({ queryKey: ["invitations"] }); },
  });
  const edit = useMutation({
    mutationFn: (input: { userId: string; role: EditableRole | null }) => apiSend("/api/workspace/members", "PATCH", input),
    onSuccess: () => { setRemove(null); void client.invalidateQueries({ queryKey: ["bootstrap"] }); },
  });

  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <h1 className="text-xl font-semibold">{workspace.name} members</h1>
    {admin && <section className="my-4 rounded-lg border border-cu-border bg-cu-panel p-4">
      <h2 className="font-semibold">Invite a teammate</h2>
      <p className="mb-3 text-sm text-cu-text-secondary">Copy the invitation link and share it with the invited person. It expires after seven days.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <label className="grid gap-1 text-xs">Email<input className={control} required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="grid gap-1 text-xs">Role<select aria-label="Role" className={control} value={role} onChange={(event) => setRole(event.target.value as EditableRole)}>
          <option value="MEMBER">Member</option><option value="GUEST">Guest</option>{owner && <option value="ADMIN">Admin</option>}
        </select></label>
        <button className={control} disabled={create.isPending}>Create invitation</button>
      </form>
      {inviteLink && <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid min-w-56 flex-1 gap-1 text-xs">Invitation link<input className={control} readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></label>
        <button className={control} onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "Copied" : "Copy link"}</button>
      </div>}
      {invitations.data && invitations.data.length > 0 && <div className="mt-4">
        <h3 className="text-sm font-medium">Pending invitations</h3>
        <ul className="divide-y divide-cu-border">{invitations.data.map((invite) => <li key={invite.id} className="flex items-center justify-between gap-2 py-2 text-sm">
          <span>{invite.email} · {invite.role.toLowerCase()} · {new Date(invite.expiresAt).toLocaleDateString()}</span>
          {(owner || invite.role !== "ADMIN") && <button className={control} disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id)} aria-label={`Revoke invitation for ${invite.email}`}>Revoke</button>}
        </li>)}</ul>
      </div>}
    </section>}
    {(create.isError || revoke.isError || edit.isError || invitations.isError) && <p role="alert" className="my-3 text-sm text-cu-urgent">Could not complete the workspace request. Check the email or your permissions.</p>}
    <ul className="divide-y divide-cu-border">
      {workspace.members.map((member) => {
        const canEdit = admin && member.userId !== currentUser.id && member.role !== "OWNER" && (owner || member.role !== "ADMIN");
        return <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-medium">{member.user.name}</p><p className="text-sm text-cu-text-secondary">{member.user.email}</p></div>
          {canEdit ? <div className="flex gap-2">
            <select className={control} aria-label={`Role for ${member.user.name}`} value={member.role} disabled={edit.isPending} onChange={(event) => edit.mutate({ userId: member.userId, role: event.target.value as EditableRole })}>
              <option value="MEMBER">Member</option><option value="GUEST">Guest</option>{owner && <option value="ADMIN">Admin</option>}
            </select>
            {remove === member.userId ? <>
              <button className={control + " text-cu-urgent"} disabled={edit.isPending} onClick={() => edit.mutate({ userId: member.userId, role: null })}>Confirm removal</button>
              <button className={control} onClick={() => setRemove(null)}>Cancel</button>
            </> : <button className={control} onClick={() => setRemove(member.userId)} aria-label={`Remove ${member.user.name}`}>Remove</button>}
          </div> : <span className="text-sm capitalize text-cu-text-secondary">{member.role.toLowerCase()}</span>}
        </li>;
      })}
    </ul>
  </main>;
}
