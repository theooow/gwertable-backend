import { z } from "zod";

export const eventSchema = z
  .object({
    name: z.string().min(1, "Le nom est requis"),
    startsAt: z.string().min(1, "La date de debut est requise"),
    endsAt: z.string().optional().or(z.literal("")),
    status: z.enum(["DRAFT", "PLANNING", "LIVE", "DONE", "ARCHIVED"]).default("DRAFT"),
    description: z.string().optional().or(z.literal("")),
    venueId: z.string().optional().or(z.literal("")),
  })
  .refine(
    (data) => {
      if (data.endsAt && data.startsAt) {
        return new Date(data.endsAt) > new Date(data.startsAt);
      }
      return true;
    },
    { message: "La date de fin doit etre apres la date de debut", path: ["endsAt"] },
  );

export type EventInput = z.infer<typeof eventSchema>;
