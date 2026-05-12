import { z } from "zod";

export const LIMITS = {
  name: 120,
  shortText: 160,
  mediumText: 500,
  longText: 2000,
  email: 254,
  phone: 40,
  discordId: 64,
  tag: 32,
  tags: 20,
  money: 12,
  url: 500,
} as const;

export function requiredText(label: string, max: number = LIMITS.shortText) {
  return z.string().trim().min(1, `${label} est requis`).max(max, `${label} ne peut pas depasser ${max} caracteres`);
}

export function optionalText(label: string, max: number = LIMITS.mediumText) {
  return z.string().trim().max(max, `${label} ne peut pas depasser ${max} caracteres`).nullish().or(z.literal(""));
}
