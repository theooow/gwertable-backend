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
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]),
});
