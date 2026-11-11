"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/components/workspace-context";
import { apiGet, apiSend } from "@/lib/api";

type Message = { id: string; body: string; senderId: string; createdAt: string };
const button = "rounded border border-cu-border px-3 py-1.5 text-sm hover:bg-cu-hover disabled:opacity-50";

export default function MessagesPage() {
  return <Suspense fallback={<p className="p-5">Loading messages…</p>}><Messages /></Suspense>;
}

function Messages() {
  const { workspace, currentUser } = useWorkspace();
  const peerId = useSearchParams().get("peer");
  const peers = workspace.members.filter((member) => member.role !== "GUEST" && member.userId !== currentUser.id);
  const peer = peers.find((member) => member.userId === peerId);
  const guest = workspace.members.find((member) => member.userId === currentUser.id)?.role === "GUEST";
  return (
    <main className="flex-1 overflow-auto p-5 sm:p-8">
      <h1 className="mb-4 text-xl font-semibold">Messages</h1>
      {guest ? <p>Direct messages are available to workspace members.</p> : (
        <div className="grid gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <nav aria-label="Teammates" className="space-y-1">
            {peers.map(({ user }) => (
              <Link key={user.id} href={`/messages?peer=${encodeURIComponent(user.id)}`} aria-current={peerId === user.id ? "page" : undefined}
                className="block rounded px-3 py-2 text-sm hover:bg-cu-hover aria-[current=page]:bg-cu-purple-light">
                {user.name}
              </Link>
            ))}
            {!peers.length && <p className="text-sm text-cu-text-secondary">No teammates available.</p>}
          </nav>
          {peer ? <Conversation key={peer.userId} peerId={peer.userId} name={peer.user.name} userId={currentUser.id} />
            : <p className="text-sm text-cu-text-secondary">Choose a teammate to open a conversation.</p>}
        </div>
      )}
    </main>
  );
}

function Conversation({ peerId, name, userId }: { peerId: string; name: string; userId: string }) {
  const [body, setBody] = useState("");
  const [older, setOlder] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const qc = useQueryClient();
  const url = `/api/messages?peer=${encodeURIComponent(peerId)}`;
  const query = useQuery({
    queryKey: ["messages", peerId],
    queryFn: () => apiGet<{ messages: Message[]; hasMore: boolean }>(url),
  });
  const send = useMutation({
    mutationFn: (text: string) => apiSend("/api/messages", "POST", { peerId, body: text }),
    onSuccess: async () => {
      setBody("");
      await qc.invalidateQueries({ queryKey: ["messages", peerId] });
    },
  });
  const loadOlder = useMutation({
    mutationFn: (before: string) => apiGet<{ messages: Message[]; hasMore: boolean }>(url + "&before=" + encodeURIComponent(before)),
    onSuccess: (result) => {
      setOlder((previous) => [...result.messages, ...previous]);
      setHasOlder(result.hasMore);
    },
  });
  const latest = query.data?.messages ?? [];
  const messages = [...new Map([...older, ...latest].map((message) => [message.id, message])).values()];
  return (
    <section className="max-w-3xl rounded border border-cu-border p-4">
      <h2 className="mb-3 font-semibold">{name}</h2>
      {query.isPending && <p>Loading conversation…</p>}
      {query.isError && <p role="alert">Could not load the conversation.</p>}
      {query.data && !messages.length && <p className="text-sm text-cu-text-secondary">No messages yet.</p>}
      {(older.length ? hasOlder : query.data?.hasMore) && messages[0] && (
        <button className={button} disabled={loadOlder.isPending} onClick={() => loadOlder.mutate(messages[0].id)}>Load older messages</button>
      )}
      {loadOlder.isError && <p role="alert">Could not load older messages.</p>}
      <ol aria-label="Conversation" className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto">
        {messages.map((message) => (
          <li key={message.id} className={`rounded p-2 text-sm ${message.senderId === userId ? "bg-cu-purple-light" : "bg-cu-hover"}`}>
            <span className="font-medium">{message.senderId === userId ? "You" : name}</span>
            <time className="ml-2 text-xs text-cu-text-secondary" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
            <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p>
          </li>
        ))}
      </ol>
      <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); if (body.trim() && !send.isPending) send.mutate(body); }}>
        <textarea aria-label="Message" placeholder="Write a message…" maxLength={8000} disabled={send.isPending}
          value={body} onChange={(event) => setBody(event.target.value)} className="w-full rounded border border-cu-border bg-cu-panel p-2 text-sm" />
        {send.isError && <p role="alert">Could not send the message. Try again.</p>}
        <button className={button} disabled={!body.trim() || send.isPending}>Send message</button>
      </form>
    </section>
  );
}
