-- New accounts pick a plan and start its trial; existing accounts keep their plan.
ALTER TABLE "User" ALTER COLUMN "usagePlan" SET DEFAULT 'NONE';
