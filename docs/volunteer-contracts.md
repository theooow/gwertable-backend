# Conventions de bénévolat

Signature électronique **simple**, intégrée à Abregi, par code email. Ce procédé
ne fournit ni vérification d’identité civile, ni certificat de signature, ni
horodatage qualifié. Il ne garantit pas l’issue d’un contrôle. La convention doit
refléter les conditions réelles du bénévolat (liberté, absence de rémunération et
de subordination) ; le canevas doit être adapté par l’organisateur.

Références : [Code civil, article 1367](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032042456/2021-10-30),
[guide du bénévolat](https://www.associations.gouv.fr/IMG/pdf/guide_benevolat_2024-2025.pdf).

## Parcours

Dans Bénévoles → Conventions, sélectionner une candidature validée, renseigner
l’identité de l’organisme, son représentant et les conditions. La création fige
le PDF et l’identité/email du contact. Télécharger et vérifier ce PDF avant
« Envoyer pour signature ». Le représentant authentifié déclare son habilitation
à émettre la convention ; ce parcours ne constitue pas une double signature OTP.

Le bénévole reçoit un lien personnel valable 30 jours, lit le texte/PDF,
demande un code, saisit son nom et accepte explicitement de signer. Après
signature, il peut télécharger son exemplaire et le dossier de preuve depuis
le même lien pendant sa validité. L’organisateur retrouve ces fichiers dans
la fiche contact et l’événement. Une invitation peut être renvoyée avant
signature, ce qui révoque le lien et les codes précédents. Pour corriger les
informations, annuler la demande et créer une nouvelle convention. Une convention
signée ne peut être annulée ou modifiée par ces API.

## Preuve et conservation

Les PDF avant/après signature sont stockés en base, avec leurs SHA-256. Le JSON
de preuve associe le PDF présenté, l’identité déclarée, l’email vérifié, le
consentement exact, les dates serveur et les informations techniques reçues.
Le PDF signé reproduit la convention et ajoute une attestation. Ce PDF n’est pas
un document PAdES et ne comporte pas de certificat cryptographique embarqué.
L’IP est celle observée par le backend (souvent le proxy), pas une IP client
certifiée. Un code email atteste de l’accès à une boîte, pas de l’identité civile.

La base bloque toute modification de la source et toute modification d’un
enregistrement signé/annulé. Les relations RESTRICT empêchent la suppression
accidentelle des contacts, candidatures, événements et espaces portant ces
conventions. L’archivage reste disponible. Un administrateur de base conserve
techniquement la capacité de modifier/supprimer les données : ceci n’est pas
un archivage probant indépendant. Sauvegarder la base et définir une politique
de conservation/RGPD adaptée ; aucune purge automatique des conventions n’est
effectuée. Les PDF ne sont pas placés dans un répertoire public.

## Configuration et sécurité

Migration `20260924120000_volunteer_contracts`, sans nouvelle variable requise.
Configurer SMTP et FRONTEND_URL en HTTPS comme pour les autres emails. Le
transport `log` refuse les envois afin de ne pas simuler une vérification.
Les liens utilisent 256 bits aléatoires et seule leur empreinte est en base.
Les codes sont liés au lien et au PDF, expirent après 10 minutes, sont limités
à 5 essais, 1 envoi/minute et 10 envois par convention. Les courses entre
signature, rotation et annulation sont arbitrées par transactions sérialisables.
Les logs applicatifs omettent les corps et masquent les liens/codes. Les logs
des reverse proxies et de l’hébergement doivent également masquer les chemins
`/volunteers/contracts/<token>` ; ne pas y activer d’analytics tiers.

Les routes événement utilisent `volunteer.manage` et le contrôle de l’événement
invité ; les routes contact utilisent `person.read` et sont interdites aux
comptes limités à un événement. L’accès public est strictement limité à la
convention identifiée par son lien et les réponses ne sont pas mises en cache.

## Vérification

`npm run typecheck`, `npm run typecheck:tests`, puis
`node --import tsx --import ./tests/setup-env.ts --test tests/volunteer-contracts.test.ts`
avec les migrations appliquées sur une base de test dédiée. Les tests remplacent
l’envoi SMTP, sans envoyer de messages réels.
