"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import type { ResourceKind } from "@/lib/resource-permissions";

type Target = { kind: ResourceKind; id: string; name: string };
type Permission = "VIEW" | "COMMENT" | "EDIT" | "FULL";
type Person = { id: string; name: string; email: string };
type Team = { id: string; name: string; members: { userId: string }[] };
type Grant = { subjectType: "person" | "team"; subjectId: string; permission: Permission };
type Access = { private: boolean; editable: boolean; canManageTeams: boolean; grants: Grant[]; people: Person[]; teams: Pick<Team, "id" | "name">[] };

const permissions: Record<Permission, string> = { VIEW: "View only", COMMENT: "Comment", EDIT: "Edit", FULL: "Full access" };
const eventName = "open-item-sharing";
const fieldClass = "rounded-md border border-cu-border bg-cu-panel px-2 py-1.5 text-sm";
const buttonClass = "rounded-md border border-cu-border px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

export function openItemSharing(kind: ResourceKind, id: string, name: string) {
  window.dispatchEvent(new CustomEvent<Target>(eventName, { detail: { kind, id, name } }));
}

export function ItemSharingHost() {
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    function open(event: Event) {
      setTarget((event as CustomEvent<Target>).detail);
    }
    window.addEventListener(eventName, open);
    return () => window.removeEventListener(eventName, open);
  }, []);
  return target && <ItemSharingDialog key={target.id} target={target} close={() => setTarget(null)} />;
}

function ItemSharingDialog({ target, close }: { target: Target; close: () => void }) {
  const endpoint = `/api/access/${target.kind}/${encodeURIComponent(target.id)}`;
  const access = useQuery({ queryKey: ["item-access", target.kind, target.id], queryFn: () => apiGet<Access>(endpoint), staleTime: 0 });
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] max-h-[85vh] w-[min(94vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-cu-border bg-cu-panel p-5 text-cu-text shadow-xl">
          <Dialog.Title className="text-base font-semibold">Sharing & permissions</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-cu-text-secondary">{target.name}</Dialog.Description>
          {access.isPending ? <p className="text-sm">Loading permissions…</p> :
            access.isError ? <p role="alert" className="text-sm">Permissions could not be loaded.</p> :
            <SharingForm key={access.dataUpdatedAt} target={target} endpoint={endpoint} access={access.data} close={close} />}
          {(access.isPending || access.isError) && <Dialog.Close className={`${buttonClass} mt-4`}>Close</Dialog.Close>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SharingForm({ target, endpoint, access, close }: { target: Target; endpoint: string; access: Access; close: () => void }) {
  const client = useQueryClient();
  const [privateItem, setPrivateItem] = useState(access.private);
  const [grants, setGrants] = useState(access.grants);
  const [subject, setSubject] = useState("");
  const [manageTeams, setManageTeams] = useState(false);
  const [teams, setTeams] = useState(access.teams);
  const options = [...access.people.map((person) => ({ key: `person:${person.id}`, label: person.name || person.email })),
    ...teams.map((team) => ({ key: `team:${team.id}`, label: `${team.name} (team)` }))];
  const save = useMutation({
    mutationFn: () => apiSend(endpoint, "PATCH", { private: privateItem, grants }),
    onSuccess: async () => {
      close();
      await client.invalidateQueries();
    },
  });
  if (!access.editable) {
    return <>
      <p className="text-sm">{access.private ? "Private" : "Workspace visibility"}</p>
      <Dialog.Close className={`${buttonClass} mt-4`}>Close</Dialog.Close>
    </>;
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={privateItem} onChange={(event) => setPrivateItem(event.target.checked)} />
        Make this {target.kind} private
      </label>
      {target.kind !== "space" && <p className="text-xs text-cu-text-secondary">
        People need access to each private parent to open this {target.kind}.
      </p>}
      <div className="space-y-2">
        {grants.map((grant, index) => {
          const key = `${grant.subjectType}:${grant.subjectId}`;
          const label = options.find((option) => option.key === key)?.label ?? grant.subjectId;
          return <div key={key} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
            <select aria-label={`Permission for ${label}`} className={fieldClass} value={grant.permission}
              onChange={(event) => setGrants(grants.map((value, position) => position === index ? { ...value, permission: event.target.value as Permission } : value))}>
              {Object.entries(permissions).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <button type="button" className={buttonClass} aria-label={`Remove ${label}`} onClick={() => setGrants(grants.filter((_, position) => position !== index))}>Remove</button>
          </div>;
        })}
        <div className="flex gap-2">
          <select aria-label="People or teams" className={`${fieldClass} min-w-0 flex-1`} value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="">Select a person or team</option>
            {options.filter(({ key }) => !grants.some((grant) => key === `${grant.subjectType}:${grant.subjectId}`))
              .map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" className={buttonClass} disabled={!subject} onClick={() => {
            const [subjectType, subjectId] = subject.split(":") as [Grant["subjectType"], string];
            setGrants([...grants, { subjectType, subjectId, permission: "VIEW" }]);
            setSubject("");
          }}>Add</button>
        </div>
      </div>
      {access.canManageTeams && <>
        <button type="button" className={buttonClass} onClick={() => setManageTeams(!manageTeams)}>{manageTeams ? "Hide teams" : "Manage teams"}</button>
        {manageTeams && <TeamEditor people={access.people} onChange={(next) => {
          setTeams(next);
          setGrants((current) => current.filter((grant) => grant.subjectType === "person" || next.some((team) => team.id === grant.subjectId)));
        }} />}
      </>}
      {save.isError && <p role="alert" className="text-sm text-cu-urgent">Permissions could not be saved.</p>}
      <div className="flex justify-end gap-2">
        <Dialog.Close className={buttonClass}>Cancel</Dialog.Close>
        <button type="submit" disabled={save.isPending} className="rounded-md bg-cu-purple px-3 py-1.5 text-sm text-white disabled:opacity-50">Save permissions</button>
      </div>
    </form>
  );
}

function TeamEditor({ people, onChange }: { people: Person[]; onChange: (teams: Team[]) => void }) {
  const endpoint = "/api/workspace/access-teams";
  const client = useQueryClient();
  const teams = useQuery({ queryKey: ["access-teams"], queryFn: () => apiGet<Team[]>(endpoint) });
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const edit = (team?: Team) => {
    setId(team?.id ?? "");
    setName(team?.name ?? "");
    setUserIds(team?.members.map((member) => member.userId) ?? []);
  };
  const save = useMutation({
    mutationFn: (remove: boolean) => apiSend(endpoint, remove ? "DELETE" : id ? "PATCH" : "POST",
      remove ? { id } : { id: id || undefined, name, userIds }),
    onSuccess: async () => {
      const next = await apiGet<Team[]>(endpoint);
      client.setQueryData(["access-teams"], next);
      onChange(next);
      edit();
    },
  });
  return <div className="space-y-2 rounded-md border border-cu-border p-3">
    {teams.isError && <p role="alert" className="text-sm text-cu-urgent">Teams could not be loaded.</p>}
    <select aria-label="Team to manage" className={`${fieldClass} w-full`} value={id} onChange={(event) => edit(teams.data?.find((team) => team.id === event.target.value))}>
      <option value="">New team</option>
      {teams.data?.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
    </select>
    <input aria-label="Team name" placeholder="Team name" className={`${fieldClass} w-full`} value={name} onChange={(event) => setName(event.target.value)} />
    <fieldset className="max-h-32 space-y-1 overflow-y-auto text-sm">
      <legend className="mb-1 font-medium">Team members</legend>
      {people.map((person) => <label key={person.id} className="flex items-center gap-2">
        <input type="checkbox" checked={userIds.includes(person.id)} onChange={(event) => setUserIds(
          event.target.checked ? [...userIds, person.id] : userIds.filter((userId) => userId !== person.id)
        )} />{person.name || person.email}
      </label>)}
    </fieldset>
    <div className="flex gap-2">
      <button type="button" className={buttonClass} disabled={!name.trim() || save.isPending} onClick={() => save.mutate(false)}>{id ? "Update team" : "Create team"}</button>
      {id && <button type="button" className={buttonClass} disabled={save.isPending} onClick={() => save.mutate(true)}>Delete team</button>}
    </div>
    {save.isError && <p role="alert" className="text-sm text-cu-urgent">Team changes could not be saved.</p>}
  </div>;
}
