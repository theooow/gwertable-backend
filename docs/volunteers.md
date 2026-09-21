# Gestion des bénévoles

## Planning, badges et espace personnel

Le parcours guidé propose la prochaine étape : inscriptions, candidatures, planning, puis badges et accueil. Le planning permet de créer jusqu’à 100 postes identiques en une fois et signale les bénévoles indisponibles lors d’une affectation manuelle.

**Proposer une affectation IA** utilise le fournisseur déjà configuré (`DOCUMENT_AI_PROVIDER`, OpenAI ou Ollama). Seuls les identifiants, horaires, préférences d’équipe et charges horaires sont transmis. Les coordonnées, réponses, notes et besoins alimentaires sont exclus. Les propositions sont filtrées puis présentées à l’organisateur ; leur application est atomique et revérifie les disponibilités, les autres événements et les affectations concurrentes. Les créneaux déjà affectés sont conservés.

Dans **Badges et accueil**, préparer les badges, les imprimer et copier le lien personnel de chaque bénévole pour le lui transmettre. Le scanner caméra nécessite HTTPS et l’autorisation caméra ; la saisie du code et la recherche par nom restent disponibles. Un second scan conserve l’heure d’arrivée initiale. Un QR contient uniquement un jeton de pointage : il ne donne pas accès à l’espace personnel. Renouveler le badge invalide aussi l’ancien lien personnel. Le retrait de validation révoque les deux jetons.

L’espace personnel `/volunteers/portal/:token` présente le badge, les créneaux et les demandes d’échange. Le bénévole propose deux créneaux futurs, puis le destinataire accepte ou refuse dans son propre espace. Aucun échange n’est appliqué avant son acceptation. L’acceptation vérifie à nouveau les deux affectations et les conflits entre événements, dans une transaction unique. Le demandeur peut annuler une demande en attente. Les demandes sont visibles dans l’espace personnel, sans envoi automatique d’email ; le bouton Actualiser recharge les réponses.

La migration `20260919160000_volunteer_operations` est additive. Les badges et liens sont créés à la demande pour les candidatures validées existantes. Déployer le backend avant le frontend.

## Parcours

1. Dans un événement, ouvrir **Participants → Bénévoles → Formulaire public**. Définir le titre, la présentation, les équipes, les questions, les informations collectées et une éventuelle clôture.
2. Créer les repas dans **Catering** : ils apparaissent automatiquement dans le formulaire.
3. Enregistrer le formulaire avec les inscriptions ouvertes, puis copier le lien public. Un formulaire fermé, expiré ou appartenant à un événement terminé/archivé n’accepte aucune inscription. Le remplacement du lien invalide immédiatement l’ancien.
4. Les candidatures arrivent **À valider**. Le contact est créé dans le carnet ou réutilisé par email dans le même espace, sans écraser une fiche existante. Une répétition de la même inscription ne modifie pas la candidature initiale.
5. L’organisation examine les réponses, affecte une équipe et valide. La validation ajoute le rôle bénévole aux participants, en préservant leurs autres rôles. Les personnes sont alors disponibles pour les tâches et le conducteur existants.
6. Le planning utilise la table `Shift` existante. Un créneau correspond à un poste et une personne. Les disponibilités et conflits entre événements sont vérifiés. Retirer la validation libère les créneaux et retire uniquement le rôle bénévole.
7. Le catering distingue les demandes en attente et les réservations confirmées. Seules les candidatures validées comptent dans la capacité et peuvent être pointées comme servies. Un repas servi doit être dépointé avant de retirer son inscription ou la validation du bénévole.

Les candidatures, créneaux et repas disposent d’exports CSV. Le carnet propose aussi une vue tableur avec tri, choix des colonnes, édition des cellules et export de la vue filtrée. Les disponibilités et besoins alimentaires peuvent être corrigés dans les détails d’une candidature ; une correction incompatible avec un créneau déjà affecté est refusée.

## API

Le rôle bénévole d’un participant crée ou réutilise sa candidature validée, même sans email. Les coordonnées affichées viennent de son contact commun ; les besoins alimentaires sont synchronisés dans les deux sens. Retirer ce rôle ou supprimer le participant annule sa candidature et libère ses créneaux, avec les mêmes contrôles sur les repas servis. Les participants bénévoles existants sont repris par la migration. Pour un ajout interne, renseigner les disponibilités dans **Détails** avant une affectation ; aucun consentement public n’est enregistré à leur place.

- Public : `GET` / `POST /api/public/volunteers/:token`.
- Gestion (organisateurs uniquement) : `GET /api/events/:eventId/volunteers`, `PUT .../form`, `POST .../form/rotate`, `PATCH .../applications/:id`.
- Créneaux et repas : `POST .../shifts|services`, `PUT` / `DELETE .../shifts|services/:id`.
- Réservation : `PUT .../services/:id/bookings` avec `{ applicationId, booked }` ; pointage : `PATCH .../bookings/:id` avec `{ served }`.
- Édition partielle du carnet : `PATCH /api/people/:id` (membres de l’espace organisateurs/admins).

L’accès des collaborateurs est contrôlé pour l’événement demandé. Les données de candidature, réponses et besoins alimentaires sont omises du journal API. Le formulaire public utilise une projection dédiée qui n’expose ni contact, ni candidature, ni notes internes. Les soumissions sont limitées à 60/minute par token/IP et par processus, avec un champ piège et une limite de corps de 64 Ko. En déploiement multi-instance, compléter cette limite avec celle du proxy.

Les transactions sérialisables avec reprise protègent les doublons, les affectations et les capacités lors d’actions concurrentes. Les réponses personnalisées conservent leur libellé au moment de la soumission. Une candidature n’accorde aucun accès utilisateur à l’application.

## Mails et confirmation des créneaux

Dans les paramètres du workspace, un administrateur peut importer le logo de l’association (PNG, JPEG ou GIF, 2 Mo maximum). Il apparaît dans les trois templates email, avec le nom du workspace et de l’événement.

- Une nouvelle inscription publique déclenche un accusé de réception. Une soumission répétée n’envoie pas de doublon.
- La validation d’une candidature crée son lien personnel et son badge, puis envoie le lien par mail. Cela fonctionne aussi lors d’un ajout depuis les participants.
- Dans le planning, **Envoyer les créneaux par mail** invite chaque bénévole concerné à accepter ou refuser ses créneaux futurs. Un planning inchangé n’est pas renvoyé ; les personnes sans email sont signalées.

L’espace personnel permet de répondre à chaque créneau. Un refus libère le poste et affiche « Refusé · à réaffecter » dans le planning de l’organisation. Modifier les horaires, le poste, l’équipe ou la personne remet la confirmation en attente. Une réponse portant sur une ancienne version est refusée. Les échanges réinitialisent aussi les confirmations.

Les envois sont inscrits dans `VolunteerEmail` dans la même transaction que l’action. Le serveur traite cette file toutes les 15 secondes, indépendamment des rappels Discord/WhatsApp, avec reprise SMTP et verrou temporaire entre workers. Configurer `MAIL_TRANSPORT=smtp`, `MAIL_FROM`, `SMTP_*` et `FRONTEND_URL` ; le mode `log` n’expédie aucun mail. Le lien et le logo utilisent l’URL publique du frontend. Le transport garantit une reprise après incident ; un crash immédiatement après acceptation SMTP peut exceptionnellement produire un doublon.

API : `POST /api/events/:eventId/volunteers/assignments/notify` retourne `{ count, missingEmail }`. `PATCH /api/public/volunteers/portal/:token/shifts/:id` attend `{ accept, version }`. Le logo se gère via `POST` / `DELETE /api/workspace/logo` et sa lecture publique via `/uploads/association-logos/:fileName`.

## Déploiement et validation

Appliquer `prisma migrate deploy` et régénérer le client Prisma avant de déployer le frontend. La migration est additive et conserve les participants/créneaux existants. Les workflows déploient la migration avant de recréer les services.

Les tests `tests/volunteers.test.ts` couvrent le parcours public, l’isolation des espaces et des collaborateurs, le consentement, les questions obligatoires, la rotation du lien, les conflits de planning, les capacités concurrentes, le pointage et les doublons. `tests/contact-cells.test.ts` vérifie qu’une modification de cellule conserve les autres champs CRM et respecte les droits.
