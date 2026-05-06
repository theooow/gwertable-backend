import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const taskSchema = z.object({
  title: requiredText("Le titre", LIMITS.name),
  description: optionalText("La description", LIMITS.longText),
  category: requiredText("La categorie", LIMITS.shortText),
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]).default("TODO"),
  priority: z.enum(["LOW", "MED", "HIGH"]).default("MED"),
  dueAt: z.string().optional().or(z.literal("")),
  assigneeId: z.string().optional().or(z.literal("")),
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]),
});
