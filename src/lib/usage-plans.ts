import type { EventStatus, UsagePlan } from "@prisma/client";
import { PlanRequiredError } from "./errors.js";

export type PlanFeature = "ai.documentImport" | "ai.agents" | "whatsapp.notifications" | "team.invite";

const planFeatures: Record<UsagePlan, readonly PlanFeature[]> = {
  BETA_TEST: ["team.invite"],
  LITE: [],
  PLUS: ["ai.documentImport"],
  PRO: ["ai.documentImport", "ai.agents", "whatsapp.notifications", "team.invite"],
};
const activeEventLimits: Record<UsagePlan, number | null> = { BETA_TEST: null, LITE: 1, PLUS: 3, PRO: null };
export const activeEventStatuses: EventStatus[] = ["DRAFT", "PLANNING", "LIVE"];
const upgradePath: UsagePlan[] = ["LITE", "PLUS", "PRO"];

export function planCan(plan: UsagePlan, feature: PlanFeature) {
  return planFeatures[plan].includes(feature);
}

export function requirePlanFeature(plan: UsagePlan, feature: PlanFeature) {
  if (!planCan(plan, feature)) {
    const requiredPlan = minimumPlan(feature);
    throw new PlanRequiredError(`Cette fonctionnalité nécessite le plan ${usagePlanLabels[requiredPlan]}.`, requiredPlan);
  }
}

export const usagePlanLabels: Record<UsagePlan, string> = {
  BETA_TEST: "Beta test",
  LITE: "Lite",
  PLUS: "Plus",
  PRO: "Pro",
};

export function activeEventLimit(plan: UsagePlan) {
  return activeEventLimits[plan];
}

export function requireActiveEventSlot(plan: UsagePlan, activeEvents: number) {
  const limit = activeEventLimits[plan];
  if (limit !== null && activeEvents >= limit) {
    const requiredPlan = upgradePath.find((candidate) => {
      const candidateLimit = activeEventLimits[candidate];
      return candidateLimit === null || candidateLimit > limit;
    }) ?? "PRO";
    throw new PlanRequiredError(`Le plan ${usagePlanLabels[plan]} est limité à ${limit} événement${limit > 1 ? "s" : ""} en cours. Clôture ou archive un événement, ou passe au plan ${usagePlanLabels[requiredPlan]}.`, requiredPlan);
  }
}

function minimumPlan(feature: PlanFeature): UsagePlan {
  return upgradePath.find((plan) => planCan(plan, feature)) ?? "PRO";
}
