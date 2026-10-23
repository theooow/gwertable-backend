-- Free-text history notes about contacts become typed interactions: map
-- recognisable notes to a kind and discard the original text.
CREATE TYPE "PersonInteractionKind" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'QUOTE_OR_CONTRACT', 'PAYMENT', 'OTHER');

-- AlterTable
ALTER TABLE "PersonHistoryNote" ADD COLUMN "kind" "PersonInteractionKind";

UPDATE "PersonHistoryNote" SET "kind" = (
  CASE
    WHEN "body" ~* '(appel|appelé|téléphone|telephone|tél\.?\s|coup de fil)' THEN 'CALL'
    WHEN "body" ~* '(e-?mail|mail|courriel)' THEN 'EMAIL'
    WHEN "body" ~* '(réunion|reunion|rdv|rendez-vous|rencontre|visio)' THEN 'MEETING'
    WHEN "body" ~* '(devis|contrat)' THEN 'QUOTE_OR_CONTRACT'
    WHEN "body" ~* '(paiement|payé|paye|facture|virement|règlement|reglement)' THEN 'PAYMENT'
    ELSE 'OTHER'
  END
)::"PersonInteractionKind";

ALTER TABLE "PersonHistoryNote" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "PersonHistoryNote" DROP COLUMN "body";
