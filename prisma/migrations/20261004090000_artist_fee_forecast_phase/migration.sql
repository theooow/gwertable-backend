-- Unpaid artist fees are forecast, not actual spending
UPDATE "Expense" SET "phase" = 'FORECAST' WHERE "sourceParticipantId" IS NOT NULL AND "reimbursement" = 'PENDING' AND "phase" = 'ACTUAL';
