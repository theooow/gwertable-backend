import type { UsagePlan } from "@prisma/client";
import { ForbiddenError } from "./errors.js";

export type PlanFeature = "ai.documentImport" | "whatsapp.notifications";

const planFeatures: Record<UsagePlan, readonly PlanFeature[]> = {
  BETA_TEST: [],
  PLATINIUM: ["ai.documentImport", "whatsapp.notifications"],
};

export function planCan(plan: UsagePlan, feature: PlanFeature) {
  return planFeatures[plan].includes(feature);
}

export function requirePlanFeature(plan: UsagePlan, feature: PlanFeature) {
  if (!planCan(plan, feature)) {
    throw new ForbiddenError("Cette fonctionnalité nécessite le plan Platinium.");
  }
}

export const usagePlanLabels: Record<UsagePlan, string> = {
  BETA_TEST: "Beta test",
  PLATINIUM: "Platinium",
};
