-- Free-text dietary fields may hold health or religious data (GDPR art. 9):
-- map recognisable answers to a closed list and discard the original text.
CREATE TYPE "DietaryPreference" AS ENUM ('NONE', 'VEGETARIAN', 'VEGAN', 'OTHER');

-- AlterTable
ALTER TABLE "VolunteerApplication" ALTER COLUMN "dietary" DROP DEFAULT;
ALTER TABLE "VolunteerApplication" ALTER COLUMN "dietary" TYPE "DietaryPreference" USING (
  CASE
    WHEN btrim("dietary") = '' OR btrim("dietary") ~* '^(aucun|aucune|non|rien|ras|n/?a|-|/)\.?$' THEN 'NONE'
    WHEN "dietary" ~* '(vegan|végan|végétalien|vegetalien)' THEN 'VEGAN'
    WHEN "dietary" ~* '(végé|vege|veggie)' THEN 'VEGETARIAN'
    ELSE 'OTHER'
  END
)::"DietaryPreference";
ALTER TABLE "VolunteerApplication" ALTER COLUMN "dietary" SET DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "EventParticipant" ALTER COLUMN "dietary" TYPE "DietaryPreference" USING (
  CASE
    WHEN "dietary" IS NULL OR btrim("dietary") = '' THEN NULL
    WHEN btrim("dietary") ~* '^(aucun|aucune|non|rien|ras|n/?a|-|/)\.?$' THEN 'NONE'
    WHEN "dietary" ~* '(vegan|végan|végétalien|vegetalien)' THEN 'VEGAN'
    WHEN "dietary" ~* '(végé|vege|veggie)' THEN 'VEGETARIAN'
    ELSE 'OTHER'
  END
)::"DietaryPreference";
