import { z } from "zod";

const text = z.string().trim().max(4000);
const name = z.string().trim().min(1).max(200);
const date = z.iso.datetime().transform((v) => new Date(v).toISOString());
export const intervalSchema = z.object({ startsAt: date, endsAt: date })
  .refine((v) => v.endsAt > v.startsAt, "La fin doit suivre le début");
export const questionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), label: name,
  type: z.enum(["text", "select", "checkbox"]), required: z.boolean(),
  options: z.array(name).max(30).default([]),
}).refine((q) => q.type !== "select" || q.options.length > 0, "Ajoutez des choix");
export const volunteerFormSchema = z.object({
  title: name, description: text, confirmationMessage: name,
  published: z.boolean(), closesAt: z.iso.datetime().nullable(),
  collectPhone: z.boolean(), collectDietary: z.boolean(),
  teams: z.array(name).max(50), questions: z.array(questionSchema).max(30),
}).refine((v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length, "Identifiants de questions dupliqués");
export const applicationSchema = z.object({
  fullName: name, email: z.email().max(254).transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(40).default(""),
  preferredTeams: z.array(name).max(50).default([]),
  availability: z.array(intervalSchema).min(1, "Indiquez au moins une disponibilité").max(50),
  dietary: text.default(""), notes: text.default(""),
  answers: z.record(z.string().max(60), z.union([text, z.boolean()])).default({}),
  mealIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  consent: z.literal(true, { error: "Votre accord est nécessaire pour traiter votre inscription" }),
  website: z.string().max(0).optional(),
});
export const reviewSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  team: z.string().trim().max(200), internalNotes: text,
  availability: z.array(intervalSchema).min(1).max(50).optional(),
  dietary: text.optional(),
});
export const shiftSchema = z.object({
  position: name, team: z.string().trim().max(200).default(""),
  startsAt: date, endsAt: date,
  assigneeId: z.string().min(1).nullable(), notes: text.default(""),
}).refine((v) => v.endsAt > v.startsAt, "La fin doit suivre le début");
export const cateringSchema = z.object({
  label: name, startsAt: z.iso.datetime(), capacity: z.number().int().min(1).max(100000).nullable(),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;
export type FormInput = z.infer<typeof volunteerFormSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type ShiftInput = z.infer<typeof shiftSchema>;
export type CateringInput = z.infer<typeof cateringSchema>;
