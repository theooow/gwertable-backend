import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

const taskChecklistItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(LIMITS.mediumText),
  done: z.boolean().default(false),
});

export const taskSchema = z.object({
  title: requiredText("Le titre", LIMITS.name),
  description: optionalText("La description", LIMITS.longText),
  category: requiredText("La categorie", LIMITS.shortText),
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]).default("TODO"),
  priority: z.enum(["LOW", "MED", "HIGH"]).default("MED"),
  tags: z.array(z.string().trim().min(1).max(LIMITS.tag)).max(LIMITS.tags).default([]),
  checklist: z.array(taskChecklistItemSchema).max(50).default([]),
  dueAt: z.string().optional().or(z.literal("")),
  assigneeId: z.string().optional().or(z.literal("")),
  assigneeIds: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]),
});

export const taskCategorySchema = z.object({
  name: requiredText("Le nom", LIMITS.tag),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "La couleur est invalide"),
});

export const taskAttachmentSchema = z.object({
  label: requiredText("Le nom", LIMITS.name),
  url: z.string().min(1).max(500),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive().max(12 * 1024 * 1024),
});

export const taskCommentSchema = z.object({
  body: requiredText("Le commentaire", LIMITS.longText),
});
