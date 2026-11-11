"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PublicIntakeForm } from "@/lib/intake-schema";

const control = "w-full rounded border border-cu-border bg-cu-panel p-2 text-sm";

export function IntakeResponse({ form, shareKey }: { form: PublicIntakeForm; shareKey?: string }) {
  const [done, setDone] = useState(false);
  const submit = useMutation({
    mutationFn: async (data: FormData) => {
      const answers = Object.fromEntries(form.questions.map(({ id }) => [id, data.get(id) ?? ""]));
      const result = await fetch(`/api/public/forms/${shareKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), answers }),
      });
      if (!result.ok) {
        const details = await result.json().catch(() => null);
        throw new Error(details?.error || "Could not send the response.");
      }
    },
    onSuccess: () => setDone(true),
  });
  return <section className="mx-auto w-full max-w-xl rounded-xl border border-cu-border bg-cu-panel p-6 sm:p-8">
    <h1 className="text-xl font-semibold">{form.title}</h1>
    {form.description && <p className="mt-2 whitespace-pre-wrap text-sm text-cu-text-secondary">{form.description}</p>}
    {done ? <div role="status" className="mt-6">
      <p>Response received.</p>
      <button onClick={() => { setDone(false); submit.reset(); }} className="mt-2 text-sm text-cu-purple hover:underline">Send another response</button>
    </div> : <form className="mt-6 grid gap-4" onSubmit={(event) => {
      event.preventDefault();
      if (shareKey) submit.mutate(new FormData(event.currentTarget));
    }}>
      <label className="grid gap-1 text-sm">Task name <input className={control} name="name" required maxLength={200} /></label>
      {form.questions.map((question) => <label key={question.id} className="grid gap-1 text-sm">
        <span>{question.label}{question.required && <span aria-hidden="true"> *</span>}</span>
        {question.type === "paragraph" ? <textarea className={control} name={question.id} required={question.required} maxLength={4000} rows={3} />
          : question.type === "choice" ? <select aria-label={question.label} className={control} name={question.id} required={question.required} defaultValue="">
            <option value="">Choose an option</option>
            {question.options.map((option) => <option key={option}>{option}</option>)}
          </select> : <input className={control} name={question.id} required={question.required} type={question.type === "email" ? "email" : "text"} maxLength={4000} />}
      </label>)}
      {submit.isError && <p role="alert" className="text-sm text-cu-urgent">{submit.error.message}</p>}
      <button disabled={submit.isPending || !shareKey} className="justify-self-start rounded bg-cu-purple px-4 py-2 text-sm text-white disabled:opacity-50">
        {submit.isPending ? "Sending…" : "Submit response"}
      </button>
    </form>}
  </section>;
}
