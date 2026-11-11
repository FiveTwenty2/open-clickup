"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { useWorkspace } from "@/components/workspace-context";
import type { listDocuments, readDocument } from "@/lib/workspace-documents";

type Document = NonNullable<Awaited<ReturnType<typeof readDocument>>>;
type Draft = Pick<Document, "title" | "body" | "revision">;
const control = "rounded border border-cu-border bg-cu-panel px-2 py-1.5 text-sm disabled:opacity-50";

function DocumentEditor({ document, editable }: { document: Document; editable: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: Partial<Draft> & { revision: number; archived?: boolean }) => apiSend<Document>(`/api/workspace/docs/${document.id}`, "PATCH", patch),
    onSuccess: (result) => {
      client.setQueryData(["document", document.id], result);
      void client.invalidateQueries({ queryKey: ["documents"] });
      setDraft(null);
    },
  });
  const conflict = draft && draft.revision !== document.revision;

  return <article className="min-w-0 flex-1 rounded border border-cu-border bg-cu-panel p-4">
    {draft ? <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(draft); }}>
      <label className="grid gap-1 text-sm">Title<input className={control} required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="grid gap-1 text-sm">Document content<textarea className={control + " min-h-[280px] resize-y leading-relaxed"} maxLength={200_000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
      {conflict && <p role="alert" className="text-sm text-cu-urgent">A teammate saved a newer version. Copy your draft before discarding it to review their changes.</p>}
      <div className="flex gap-2">
        <button className={control} disabled={!!conflict || save.isPending || !draft.title.trim()}>Save document</button>
        <button type="button" className={control} onClick={() => { setDraft(null); save.reset(); }}>Discard draft</button>
      </div>
    </form> : <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{document.title}</h2>
        {editable && <div className="flex gap-2">
          {!document.archived && <button className={control} onClick={() => { save.reset(); setDraft({ title: document.title, body: document.body, revision: document.revision }); }}>Edit document</button>}
          <button className={control} disabled={save.isPending} onClick={() => save.mutate({ revision: document.revision, archived: !document.archived })}>{document.archived ? "Restore document" : "Archive document"}</button>
        </div>}
      </div>
      <div className="space-y-2 break-words text-sm leading-relaxed">
        {document.body ? document.body.split("\n").map((line, index) => {
          if (line.startsWith("## ")) return <h3 key={index} className="pt-2 text-lg font-semibold">{line.slice(3)}</h3>;
          if (line.startsWith("# ")) return <h3 key={index} className="pt-2 text-xl font-semibold">{line.slice(2)}</h3>;
          return <p key={index} className="whitespace-pre-wrap">{line || "\u00A0"}</p>;
        }) : <p className="text-cu-text-secondary">This document is empty.</p>}
      </div>
    </>}
    {save.isError && <p role="alert" className="mt-2 text-sm text-cu-urgent">Could not save this document. Your draft is still available.</p>}
  </article>;
}

function DocumentLibrary() {
  const { currentUser, workspace } = useWorkspace();
  const editable = workspace.members.some((member) => member.userId === currentUser.id && member.role !== "GUEST");
  const [archived, setArchived] = useState(false);
  const [title, setTitle] = useState("");
  const router = useRouter();
  const selected = useSearchParams().get("doc");
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["documents", archived],
    queryFn: () => apiGet<Awaited<ReturnType<typeof listDocuments>>>(`/api/workspace/docs?archived=${archived}`),
  });
  const document = useQuery({
    queryKey: ["document", selected], enabled: !!selected,
    queryFn: () => apiGet<Document>(`/api/workspace/docs/${selected}`),
  });
  const create = useMutation({
    mutationFn: () => apiSend<Document>("/api/workspace/docs", "POST", { title }),
    onSuccess: (result) => {
      setTitle("");
      setArchived(false);
      client.setQueryData(["document", result.id], result);
      void client.invalidateQueries({ queryKey: ["documents"] });
      router.push(`/docs?doc=${result.id}`);
    },
  });
  return <main className="flex-1 overflow-auto p-5 sm:p-8">
    <h1 className="mb-3 text-xl font-semibold">Workspace docs</h1>
    {editable && <form className="mb-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <input aria-label="New document title" placeholder="New document title" required maxLength={160} className={control} value={title} onChange={(event) => setTitle(event.target.value)} />
      <button className={control} disabled={create.isPending || !title.trim()}>Create document</button>
    </form>}
    {(list.isError || document.isError || create.isError) && <p role="alert" className="mb-3 text-sm text-cu-urgent">Could not complete the document request.</p>}
    <div className="grid gap-4 md:grid-cols-[230px_1fr]">
      <nav aria-label="Documents" className="rounded border border-cu-border bg-cu-panel p-3">
        <button className={control} aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? "Show active documents" : "Show archived documents"}</button>
        <ul className="mt-2">{list.data?.map((entry) => <li key={entry.id}><Link className="block truncate rounded p-2 text-sm hover:bg-cu-hover aria-[current=page]:bg-cu-hover" aria-current={selected === entry.id ? "page" : undefined} href={`/docs?doc=${entry.id}`}>{entry.title}</Link></li>)}</ul>
        {list.data?.length === 0 && <p className="mt-2 text-sm text-cu-text-secondary">No documents here.</p>}
      </nav>
      {document.data ? <DocumentEditor key={document.data.id} document={document.data} editable={editable} /> : <p className="p-4 text-sm text-cu-text-secondary">Select a document.</p>}
    </div>
  </main>;
}

export default function DocsPage() {
  return <Suspense fallback={<p className="p-5">Loading docs…</p>}><DocumentLibrary /></Suspense>;
}
