import { z } from "zod";

export const taskSchema = z.object({
  title: z.string().min(1, "Le titre est requis"),
  description: z.string().optional().or(z.literal("")),
  category: z.string().min(1, "La categorie est requise"),
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]).default("TODO"),
  priority: z.enum(["LOW", "MED", "HIGH"]).default("MED"),
  dueAt: z.string().optional().or(z.literal("")),
  assigneeId: z.string().optional().or(z.literal("")),
});

export const taskStatusSchema = z.object({
  status: z.enum(["TODO", "DOING", "DONE", "BLOCKED"]),
});
