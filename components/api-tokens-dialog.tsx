"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";

type Token = { id: string; name: string; prefix: string; writable: boolean; expiresAt: string };
const endpoint = "/api/me/api-tokens";
const key = ["api-tokens"];
const button = "rounded border border-cu-border px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

export function ApiTokensDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [writable, setWritable] = useState(false);
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const { data, isPending, isError } = useQuery({ queryKey: key, queryFn: () => apiGet<Token[]>(endpoint) });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => apiSend<Token & { token: string }>(endpoint, "POST", { name, writable }),
    onSuccess: ({ token }) => {
      setSecret(token);
      setCopied(false);
      setName("");
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiSend(endpoint, "DELETE", { id }),
    onSuccess: () => { setSecret(""); void refresh(); },
  });

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[51] max-h-[85vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-cu-panel p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">API tokens</Dialog.Title>
            <Dialog.Close className={button}>Close</Dialog.Close>
          </div>
          <Dialog.Description className="my-3 text-sm text-cu-text-secondary">
            Give a script access to this workspace. Tokens expire after 90 days.
          </Dialog.Description>
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <label className="grid gap-1 text-sm">
              Token name
              <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-cu-border bg-cu-bg p-2" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={writable} onChange={(event) => setWritable(event.target.checked)} /> Allow creating and editing tasks
            </label>
            <button className={button} disabled={!name.trim() || create.isPending}>Create token</button>
          </form>
          {secret && (
            <div className="my-3 grid gap-2 rounded border border-cu-border p-3 text-sm">
              <label className="grid gap-1">Copy this token now. It is only shown once.
                <input readOnly value={secret} className="rounded border border-cu-border bg-cu-bg p-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
              </label>
              <button className={button} onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true)).catch(() => setCopied(false))}>
                {copied ? "Copied" : "Copy token"}
              </button>
            </div>
          )}
          {isPending && <p className="mt-3 text-sm">Loading tokens…</p>}
          {(isError || create.isError || revoke.isError) && <p role="alert" className="mt-3 text-sm text-cu-urgent">Could not complete the token request. Check your access and try again.</p>}
          <ul className="mt-3 divide-y divide-cu-border">
            {data?.map((token) => (
              <li key={token.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{token.name}</div>
                  <div className="text-xs text-cu-text-secondary">{token.prefix}… · {token.writable ? "Read and write" : "Read only"} · Expires {new Date(token.expiresAt).toLocaleDateString()}</div>
                </div>
                <button className={button} disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)} aria-label={`Revoke ${token.name}`}>Revoke</button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
