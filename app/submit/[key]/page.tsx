"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { PublicIntakeForm } from "@/lib/intake-schema";
import { IntakeResponse } from "@/components/views/intake-response";

export default function PublicFormPage() {
  const { key } = useParams<{ key: string }>();
  const query = useQuery({
    queryKey: ["public-intake", key],
    queryFn: () => apiGet<PublicIntakeForm>(`/api/public/forms/${encodeURIComponent(key)}`),
    retry: false,
  });
  return <main className="min-h-dvh overflow-auto bg-cu-bg p-4 pt-12 text-cu-text">
    {query.isPending && <p role="status" className="text-center">Loading form…</p>}
    {query.isError && <p role="alert" className="text-center">This form is unavailable.</p>}
    {query.data && <IntakeResponse key={key} form={query.data} shareKey={key} />}
  </main>;
}
