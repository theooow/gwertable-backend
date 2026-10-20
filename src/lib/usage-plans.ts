import type { UsagePlan } from "@prisma/client";
import { ForbiddenError } from "./errors.js";

export type PlanFeature = "ai.documentImport" | "ai.agents" | "whatsapp.notifications";

const planFeatures: Record<UsagePlan, readonly PlanFeature[]> = {
  BETA_TEST: [],
  LITE: [],
  PLUS: ["ai.documentImport"],
  PRO: ["ai.documentImport", "ai.agents", "whatsapp.notifications"],
};
const upgradePath: UsagePlan[] = ["LITE", "PLUS", "PRO"];

export function planCan(plan: UsagePlan, feature: PlanFeature) {
  return planFeatures[plan].includes(feature);
}

export function requirePlanFeature(plan: UsagePlan, feature: PlanFeature) {
  if (!planCan(plan, feature)) {
    throw new ForbiddenError(`Cette fonctionnalité nécessite le plan ${minimumPlanLabel(feature)}.`);
  }
}

export const usagePlanLabels: Record<UsagePlan, string> = {
  BETA_TEST: "Beta test",
  LITE: "Lite",
  PLUS: "Plus",
  PRO: "Pro",
};

export function minimumPlanLabel(feature: PlanFeature) {
  return usagePlanLabels[upgradePath.find((plan) => planCan(plan, feature)) ?? "PRO"];
}
