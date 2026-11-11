import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, route, validateInput } from "@/lib/api-helpers";
import { intakeFormSchema } from "@/lib/intake-schema";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { publish } from "@/lib/events";
import { isCompletedStatus } from "@/lib/task-status";

type Ctx = { params: Promise<{ key: string }> };
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
const responseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  answers: z.record(z.string().uuid(), z.string().trim().max(4000)),
});
const published = (key: string) => ({ shareKey: key, published: true, list: { archivedAt: null } });

export const GET = route(async (_req, { params }: Ctx) => {
  const { key } = await params;
  const form = await prisma.intakeForm.findFirst({ where: published(key), select: { title: true, description: true, questions: true } });
  if (!form) throw new ApiError(404, "This form is unavailable");
  return NextResponse.json(form, { headers });
});

async function limitedJson(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Submission is empty");
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100_000) {
      await reader.cancel();
      throw new ApiError(413, "Submission is too large");
    }
    body += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()); }
  catch { throw new ApiError(400, "Invalid submission"); }
}

export const POST = route(async (req, { params }: Ctx) => {
  const { key } = await params;
  const ipLimit = rateLimit("form-submit-ip:" + clientIp(req), 20, 60_000);
  if (!ipLimit.ok) return NextResponse.json({ error: "Try again in a minute" }, {
    status: 429, headers: { ...headers, "Retry-After": String(ipLimit.retryAfter) },
  });
  const { name, answers } = validateInput(await limitedJson(req), responseSchema);
  const listId = await prisma.$transaction(async (tx) => {
    const form = await tx.intakeForm.findFirst({ where: published(key) });
    if (!form) throw new ApiError(404, "This form is unavailable");
    const formLimit = rateLimit("form-submit-key:" + key, 120, 60_000);
    if (!formLimit.ok) throw new ApiError(429, "This form is receiving too many requests");
    const questions = intakeFormSchema.shape.questions.parse(form.questions);
    if (Object.keys(answers).some((id) => !questions.some((question) => question.id === id))) {
      throw new ApiError(409, "The form changed. Reload it before submitting");
    }
    const lines = questions.map((question) => {
      const answer = answers[question.id] ?? "";
      if (question.required && !answer) throw new ApiError(400, `Answer required: ${question.label}`);
      if (answer && question.type === "email" && !z.email().safeParse(answer).success) throw new ApiError(400, `Enter a valid email: ${question.label}`);
      if (answer && question.type === "choice" && !question.options.includes(answer)) throw new ApiError(400, `Choose an option: ${question.label}`);
      return `<p><strong>${escape(question.label)}</strong><br>${escape(answer)}</p>`;
    });
    const status = await tx.status.findFirst({
      where: { listId: form.listId }, orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    if (!status) throw new ApiError(409, "This form cannot accept submissions");
    const last = await tx.task.aggregate({ where: { listId: form.listId, parentId: null }, _max: { position: true } });
    const task = await tx.task.create({ data: {
      name, description: lines.join(""), listId: form.listId, statusId: status.id,
      position: (last._max.position ?? 0) + 1000,
      completedAt: isCompletedStatus(status.type) ? new Date() : null,
    } });
    await tx.activity.create({ data: { taskId: task.id, type: "form_submitted", data: { formId: form.id, formTitle: form.title } } });
    return form.listId;
  });
  publish({ type: "list", listId });
  return NextResponse.json({ ok: true }, { status: 201, headers });
});
