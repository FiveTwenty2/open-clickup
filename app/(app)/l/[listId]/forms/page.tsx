"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api";
import { IntakeResponse } from "@/components/views/intake-response";
import { intakeFormSchema, type IntakeFormInput, type IntakeQuestion } from "@/lib/intake-schema";

type StoredForm = IntakeFormInput & { id: string; shareKey: string };
const empty: IntakeFormInput = { title: "", description: "", questions: [], published: false };
const control = "rounded border border-cu-border bg-cu-panel px-3 py-2 text-sm disabled:opacity-50";
const types: Record<IntakeQuestion["type"], string> = { text: "Short text", paragraph: "Paragraph", email: "Email", choice: "Choice" };

export default function ListFormsPage() {
  const { listId } = useParams<{ listId: string }>();
  const [selected, setSelected] = useState<StoredForm | null>(null);
  const [draft, setDraft] = useState<IntakeFormInput>(empty);
  const [preview, setPreview] = useState(false);
  const [issue, setIssue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const client = useQueryClient();
  const path = `/api/lists/${listId}/forms`;
  const key = ["intake-forms", listId];
  const query = useQuery({ queryKey: key, queryFn: () => apiGet<StoredForm[]>(path), retry: false });
  function pick(form: StoredForm | null) {
    setSelected(form);
    setDraft(form ?? empty);
    setIssue("");
    setConfirmDelete(false);
  }
  const save = useMutation({
    mutationFn: (data: IntakeFormInput) => apiSend<StoredForm>(path, selected ? "PATCH" : "POST", { ...data, id: selected?.id }),
    onSuccess: (form) => { pick(form); void client.invalidateQueries({ queryKey: key }); },
    onError: () => setIssue("Could not save the form."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiSend(path, "DELETE", { id }),
    onSuccess: () => { pick(null); void client.invalidateQueries({ queryKey: key }); },
    onError: () => setIssue("Could not delete the form."),
  });
  const busy = save.isPending || remove.isPending;

  function changeQuestion(index: number, patch: Partial<IntakeQuestion>) {
    setDraft((form) => ({ ...form, questions: form.questions.map((question, i) => i === index ? { ...question, ...patch } : question) }));
  }

  return <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-8">
    <Link className="text-sm text-cu-purple hover:underline" href={`/l/${listId}`}>Back to list</Link>
    <h1 className="mb-4 mt-2 text-xl font-semibold">Intake forms</h1>
    {query.isError ? <p role="alert">Could not load forms. List editing access is required.</p> : <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="List forms" className="grid content-start gap-2">
        <button className={control + " text-left"} disabled={busy} onClick={() => pick(null)}>New form</button>
        {query.data?.map((form) => <button key={form.id} className={control + " break-words text-left aria-pressed:border-cu-purple"}
          disabled={busy} aria-pressed={selected?.id === form.id} onClick={() => pick(form)}>
          {form.title} <span className="text-xs text-cu-text-secondary">· {form.published ? "Published" : "Draft"}</span>
        </button>)}
      </nav>
      <div className="max-w-3xl">
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const result = intakeFormSchema.safeParse(draft);
          if (!result.success) {
            setIssue(result.error.issues.map((item) => item.message).join(". "));
            return;
          }
          setIssue("");
          save.mutate(result.data);
        }}>
          <fieldset disabled={busy} className="grid gap-3">
            <label className="grid gap-1 text-sm">Form title<input className={control} required maxLength={150} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="grid gap-1 text-sm">Form description<textarea className={control} rows={2} maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <p className="text-xs text-cu-text-secondary">The required task name becomes the title of the task created from each response.</p>
            {draft.questions.map((question, index) => <div className="grid gap-2 rounded border border-cu-border p-3" key={question.id}>
              <div className="flex flex-wrap gap-2">
                <input aria-label={`Question ${index + 1} label`} required maxLength={120} placeholder="Question label" className={control + " min-w-40 flex-1"}
                  value={question.label} onChange={(event) => changeQuestion(index, { label: event.target.value })} />
                <select aria-label={`Question ${index + 1} type`} className={control} value={question.type}
                  onChange={(event) => changeQuestion(index, { type: event.target.value as IntakeQuestion["type"] })}>
                  {Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button type="button" aria-label={`Remove question ${index + 1}`} className={control} onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}>Remove</button>
              </div>
              <label className="flex gap-2 text-xs"><input type="checkbox" checked={question.required} onChange={(event) => changeQuestion(index, { required: event.target.checked })} /> Required</label>
              {question.type === "choice" && <label className="grid gap-1 text-xs">Options, one per line
                <textarea className={control} rows={3} value={question.options.join("\n")} onChange={(event) => changeQuestion(index, { options: event.target.value.split("\n") })}
                  onBlur={() => changeQuestion(index, { options: question.options.map((option) => option.trim()).filter(Boolean) })} />
              </label>}
            </div>)}
            <button type="button" className={control + " justify-self-start"} disabled={draft.questions.length >= 20}
              onClick={() => setDraft({ ...draft, questions: [...draft.questions, { id: crypto.randomUUID(), label: "", type: "text", required: false, options: [] }] })}>Add question</button>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} /> Publish for anyone with the link</label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button className={control + " bg-cu-purple text-white"} disabled={busy}>Save form</button>
            <button type="button" className={control} onClick={() => setPreview(!preview)} aria-expanded={preview}>Preview form</button>
            {selected && <button type="button" className={control + " text-cu-urgent"} disabled={busy}
              onClick={() => confirmDelete ? remove.mutate(selected.id) : setConfirmDelete(true)}>{confirmDelete ? "Confirm delete" : "Delete form"}</button>}
          </div>
          {issue && <p role="alert" className="text-sm text-cu-urgent">{issue}</p>}
        </form>
        {selected?.published && <p className="mt-4 text-sm">Published link <a className="text-cu-purple hover:underline" href={`/submit/${selected.shareKey}`} target="_blank" rel="noreferrer">Open public form</a></p>}
        {preview && <div className="mt-4"><IntakeResponse form={{ ...draft, title: draft.title || "Untitled form" }} /></div>}
      </div>
    </div>}
  </main>;
}
