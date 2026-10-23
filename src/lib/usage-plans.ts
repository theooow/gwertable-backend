import type { EventStatus, UsagePlan } from "@prisma/client";
import { PlanRequiredError } from "./errors.js";

export type PlanFeature = "ai.documentImport" | "ai.agents" | "team.invite" | "accounting.statements" | "workspace.create";

const planFeatures: Record<UsagePlan, readonly PlanFeature[]> = {
  BETA_TEST: ["team.invite", "workspace.create"],
  // Invited collaborators without a plan use the workspace they join but cannot open their own.
  NONE: [],
  LITE: ["workspace.create"],
  PLUS: ["ai.documentImport", "team.invite", "workspace.create"],
  PRO: ["ai.documentImport", "ai.agents", "team.invite", "accounting.statements", "workspace.create"],
};
// past_due keeps access while Smart Retries try to recover the payment.
export const ENTITLED_SUBSCRIPTION_STATUSES = new Set<string>(["trialing", "active", "past_due"]);

type PlanSources = {
  planGrant: UsagePlan | null;
  planGrantUntil: Date | null;
  subscriptionPlan: UsagePlan | null;
  subscriptionStatus: string | null;
};

export function activeGrant({ planGrant, planGrantUntil }: Pick<PlanSources, "planGrant" | "planGrantUntil">, now = new Date()) {
  return planGrant && (!planGrantUntil || planGrantUntil > now) ? planGrant : null;
}

/** A running admin grant wins over Stripe; otherwise the paid plan while the subscription is entitled. */
export function effectivePlan(sources: PlanSources, now = new Date()): UsagePlan {
  const grant = activeGrant(sources, now);
  if (grant) return grant;
  return sources.subscriptionPlan && ENTITLED_SUBSCRIPTION_STATUSES.has(sources.subscriptionStatus ?? "") ? sources.subscriptionPlan : "NONE";
}

const activeEventLimits: Record<UsagePlan, number | null> = { BETA_TEST: null, NONE: 0, LITE: 1, PLUS: 3, PRO: null };
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
  NONE: "Sans abonnement",
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
    if (limit === 0) throw new PlanRequiredError(`Choisis un abonnement pour avoir un événement en cours, à partir du plan ${usagePlanLabels[requiredPlan]}.`, requiredPlan);
    throw new PlanRequiredError(`Le plan ${usagePlanLabels[plan]} est limité à ${limit} événement${limit > 1 ? "s" : ""} en cours. Clôture ou archive un événement, ou passe au plan ${usagePlanLabels[requiredPlan]}.`, requiredPlan);
  }
}

function minimumPlan(feature: PlanFeature): UsagePlan {
  return upgradePath.find((plan) => planCan(plan, feature)) ?? "PRO";
}
