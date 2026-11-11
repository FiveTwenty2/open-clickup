import { z } from "zod";

export const questionSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  type: z.enum(["text", "paragraph", "email", "choice"]),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(120)).max(20),
}).refine((question) => question.type !== "choice" || (question.options.length >= 2 && new Set(question.options).size === question.options.length),
  { message: "Choice questions need at least two distinct options" });

export const intakeFormSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000),
  questions: z.array(questionSchema).max(20).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  published: z.boolean(),
});

export type IntakeFormInput = z.infer<typeof intakeFormSchema>;
export type IntakeQuestion = z.infer<typeof questionSchema>;
export type PublicIntakeForm = Pick<IntakeFormInput, "title" | "description" | "questions">;
