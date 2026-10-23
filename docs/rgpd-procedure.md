# Procédure RGPD interne

Document interne : rôles, durées de conservation appliquées par le code et traitement des demandes. Les textes publics sont la politique de confidentialité, les CGU, les CGV et l'accord de sous-traitance (`/sous-traitance`) du frontend.

## Rôles

| Données | Rôle d'Abregi | Responsable de traitement |
|---|---|---|
| Comptes, facturation, assistance, communications, mesure d'audience, essais budget | Responsable de traitement | Abregi |
| Contenu des espaces de travail (contacts, bénévoles, participants, plannings, documents) | Sous-traitant (art. 28) | L'organisation cliente |
| Statistiques issues d'événements anonymisés | Hors RGPD (données anonymes) | — |

## Durées de conservation appliquées

Les purges tournent dans `src/workers/retention-worker.ts` (toutes les 6 heures) et `src/workers/budget-lead-reminder-worker.ts`.

| Données | Déclencheur | Sort | Code |
|---|---|---|---|
| Compte utilisateur | 3 ans sans connexion (`User.lastSeenAt`), email d'avertissement 30 jours avant ; jamais pour un abonnement actif | Supprimé | `warnInactiveAccounts`, `deleteInactiveAccounts` |
| Espace de travail | Dernier membre parti (suppression de compte ou inactivité) | Anonymisé : événements gardés pour les statistiques | `anonymizeWorkspace` |
| Candidature bénévole, préférence alimentaire des participants | 1 an après la fin de l'événement (sauf contrat encore conservé) | Supprimée, le contact reste dans le carnet | `purgeVolunteerData` |
| Contrat de bénévolat | Durée choisie par l'organisation (3 ans par défaut) après la fin de l'événement | Supprimé | `purgeVolunteerData` |
| Contact supprimé par le client | Demande du client | Supprimé, ou anonymisé s'il reste lié à un contrat, une annonce ou un compte | `DELETE /api/people/:id` |
| Journal d'API | 30 jours | Supprimé | `src/plugins/api-logs.ts` |
| Essai du dashboard budget sans compte | 90 jours | Supprimé | `purgeExpiredBudgetTrials` |
| Factures | 10 ans | Conservées par Stripe | — |
| Sauvegardes Hostinger | Hebdomadaires, 2 conservées (Pays-Bas) | Écrasées en 2 à 3 semaines | — |

### Ce que garde un espace anonymisé

Conservé : événements (dates, statut, genres, nombre de collectifs, paramètres budgétaires), lieu réduit à « code postal ville » et capacité, montants et catégories des dépenses et recettes (le libellé est remplacé par la catégorie), billetterie, consommables, matériel sans photo ni propriétaire.

Supprimé : membres, invitations, contacts et leurs documents, bénévoles, contrats, participants, tâches, planning, conducteur, courses, annonces, documents, canaux, notifications, journal d'activité, factures émises, notes de frais, exercices comptables, identité juridique, fournisseurs, fichiers téléversés, identifiants Shotgun. Nom de l'espace et des événements remplacés.

### Règles pour les futures statistiques de tendances

- Ne publier que des agrégats (moyennes, médianes, volumes), jamais une ligne d'événement.
- N'afficher un segment (genre × département × période) que s'il regroupe au moins 5 événements de 3 organisations différentes, sinon un organisateur reste reconnaissable.
- Le département se déduit du code postal du lieu ; ne pas descendre plus fin que la ville.

## Registre des demandes

Tenir un tableur avec une ligne par demande :

| Reçue le | Demandeur | Canal | Type (accès, rectification, effacement, opposition, portabilité) | Abregi responsable ou sous-traitant | Vérification d'identité | Actions | Répondue le | Clôturée le |
|---|---|---|---|---|---|---|---|---|

## Demande d'un utilisateur ou client (Abregi responsable)

1. Consigner la demande dans le registre.
2. Vérifier l'identité : une demande envoyée depuis l'email du compte suffit ; sinon, demander une confirmation depuis cet email. Pièce d'identité seulement en cas de doute sérieux.
3. Répondre sous un mois (prolongeable de deux mois si la demande est complexe, en prévenant la personne avant la fin du premier mois).
4. Accès / portabilité : exporter la ligne `User`, ses `WorkspaceMember` (nom des espaces et rôle), son statut d'abonnement, la liste des destinataires (section 5 de la politique). Les factures se téléchargent depuis Stripe.
5. Effacement : l'utilisateur peut le faire seul (Paramètres → Supprimer mon compte, `DELETE /api/account`). Sinon, le faire pour lui. Supprimer aussi son contact dans Brevo. Lui indiquer ce qui reste : factures chez Stripe 10 ans, sauvegardes 2 à 3 semaines, événements de son espace sous forme anonyme s'il en était le dernier membre.
6. Répondre par écrit et clôturer la ligne.

## Demande d'une personne enregistrée par une organisation (Abregi sous-traitant)

1. Consigner la demande. Ne rien supprimer soi-même et ne pas répondre sur le fond.
2. Chercher l'email dans `Person` (tous espaces confondus) sans révéler à la personne quelles organisations détiennent ses données.
3. Transmettre la demande à un administrateur de chaque organisation concernée sous 5 jours ouvrés.
4. Répondre à la personne que sa demande a été transmise à l'organisation, qui lui répondra.
5. Aider l'organisation si elle le demande : elle peut supprimer le contact elle-même (fiche contact → Supprimer, `DELETE /api/people/:id`).

## Violation de données

1. Contenir l'incident, évaluer les données et personnes touchées, consigner les faits et les mesures.
2. Données de clients : notifier chaque client concerné sous 48 heures (accord de sous-traitance, art. 8).
3. Données dont Abregi est responsable : notifier la CNIL sous 72 heures si un risque existe, et les personnes concernées si le risque est élevé.
