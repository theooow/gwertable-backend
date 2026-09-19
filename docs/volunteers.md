# Gestion des bénévoles

## Parcours

1. Dans un événement, ouvrir **Bénévoles → Formulaire public**. Définir le titre, la présentation, les équipes, les questions, les informations collectées et une éventuelle clôture.
2. Créer les repas dans **Catering** : ils apparaissent automatiquement dans le formulaire.
3. Enregistrer le formulaire avec les inscriptions ouvertes, puis copier le lien public. Un formulaire fermé, expiré ou appartenant à un événement terminé/archivé n’accepte aucune inscription. Le remplacement du lien invalide immédiatement l’ancien.
4. Les candidatures arrivent **À valider**. Le contact est créé dans le carnet ou réutilisé par email dans le même espace, sans écraser une fiche existante. Une répétition de la même inscription ne modifie pas la candidature initiale.
5. L’organisation examine les réponses, affecte une équipe et valide. La validation ajoute le rôle bénévole aux participants, en préservant leurs autres rôles. Les personnes sont alors disponibles pour les tâches et le conducteur existants.
6. Le planning utilise la table `Shift` existante. Un créneau correspond à un poste et une personne. Les disponibilités et conflits entre événements sont vérifiés. Retirer la validation libère les créneaux et retire uniquement le rôle bénévole.
7. Le catering distingue les demandes en attente et les réservations confirmées. Seules les candidatures validées comptent dans la capacité et peuvent être pointées comme servies. Un repas servi doit être dépointé avant de retirer son inscription ou la validation du bénévole.

Les candidatures, créneaux et repas disposent d’exports CSV. Le carnet propose aussi une vue tableur avec tri, choix des colonnes, édition des cellules et export de la vue filtrée. Les disponibilités et besoins alimentaires peuvent être corrigés dans les détails d’une candidature ; une correction incompatible avec un créneau déjà affecté est refusée.

## API

- Public : `GET` / `POST /api/public/volunteers/:token`.
- Gestion (organisateurs uniquement) : `GET /api/events/:eventId/volunteers`, `PUT .../form`, `POST .../form/rotate`, `PATCH .../applications/:id`.
- Créneaux et repas : `POST .../shifts|services`, `PUT` / `DELETE .../shifts|services/:id`.
- Réservation : `PUT .../services/:id/bookings` avec `{ applicationId, booked }` ; pointage : `PATCH .../bookings/:id` avec `{ served }`.
- Édition partielle du carnet : `PATCH /api/people/:id` (membres de l’espace organisateurs/admins).

L’accès des collaborateurs est contrôlé pour l’événement demandé. Les données de candidature, réponses et besoins alimentaires sont omises du journal API. Le formulaire public utilise une projection dédiée qui n’expose ni contact, ni candidature, ni notes internes. Les soumissions sont limitées à 60/minute par token/IP et par processus, avec un champ piège et une limite de corps de 64 Ko. En déploiement multi-instance, compléter cette limite avec celle du proxy.

Les transactions sérialisables avec reprise protègent les doublons, les affectations et les capacités lors d’actions concurrentes. Les réponses personnalisées conservent leur libellé au moment de la soumission. Une candidature n’accorde aucun accès utilisateur à l’application et n’envoie pas automatiquement d’email.

## Déploiement et validation

Appliquer `prisma migrate deploy` et régénérer le client Prisma avant de déployer le frontend. La migration est additive et conserve les participants/créneaux existants. Les workflows déploient la migration avant de recréer les services.

Les tests `tests/volunteers.test.ts` couvrent le parcours public, l’isolation des espaces et des collaborateurs, le consentement, les questions obligatoires, la rotation du lien, les conflits de planning, les capacités concurrentes, le pointage et les doublons. `tests/contact-cells.test.ts` vérifie qu’une modification de cellule conserve les autres champs CRM et respecte les droits.
