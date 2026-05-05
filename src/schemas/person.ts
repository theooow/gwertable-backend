import { z } from "zod";

export const personSchema = z.object({
  fullName: z.string().min(1, "Le nom est requis"),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  discordUserId: z.string().optional().or(z.literal("")),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional().or(z.literal("")),
});

export type PersonInput = z.infer<typeof personSchema>;
