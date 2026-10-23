-- AlterTable
ALTER TABLE "User" ADD COLUMN     "planGrant" "UsagePlan",
ADD COLUMN     "planGrantUntil" TIMESTAMP(3),
ADD COLUMN     "subscriptionPlan" "UsagePlan";

-- Plans paid through Stripe.
UPDATE "User" SET "subscriptionPlan" = "usagePlan"
WHERE "subscriptionStatus" IN ('trialing', 'active', 'past_due') AND "usagePlan" IN ('LITE', 'PLUS', 'PRO');

-- Any other plan was set by hand (beta testers, manual upgrades): keep it as a grant without end date.
UPDATE "User" SET "planGrant" = "usagePlan"
WHERE "usagePlan" <> 'NONE' AND ("subscriptionStatus" IS NULL OR "subscriptionStatus" NOT IN ('trialing', 'active', 'past_due'));
