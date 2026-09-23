// Editorial descriptions only. Request schemas come from route.config.documentation.
export type RouteDoc = { tags: string[]; summary: string; description?: string };

export const routeDocs: Record<string, RouteDoc> = {
  "GET /health": {
    "tags": [
      "Système"
    ],
    "summary": "Vérification de l'état du serveur"
  },
  "POST /api/auth/login-link": {
    "tags": [
      "Auth"
    ],
    "summary": "Envoyer un lien de connexion par email",
    "description": "Génère un token à usage unique et l'envoie par email. Si `inviteToken` est fourni, valide l'invitation avant d'envoyer."
  },
  "POST /api/auth/verify": {
    "tags": [
      "Auth"
    ],
    "summary": "Vérifier le token et ouvrir une session",
    "description": "Consomme le token (usage unique), crée l'utilisateur si nécessaire, accepte l'invitation si fournie, et retourne un `sessionToken`."
  },
  "GET /api/auth/me": {
    "tags": [
      "Auth"
    ],
    "summary": "Retourner l'utilisateur courant"
  },
  "POST /api/auth/logout": {
    "tags": [
      "Auth"
    ],
    "summary": "Invalider la session courante"
  },
  "GET /api/account": {
    "tags": [
      "Compte"
    ],
    "summary": "Retourner le profil de l'utilisateur courant"
  },
  "PUT /api/account": {
    "tags": [
      "Compte"
    ],
    "summary": "Mettre à jour le profil utilisateur"
  },
  "DELETE /api/account": {
    "tags": [
      "Compte"
    ],
    "summary": "Supprimer le compte (confirmation par email)",
    "description": "Supprime le compte. Si l'utilisateur est le seul membre de son workspace, supprime aussi le workspace."
  },
  "PUT /api/account/workspace": {
    "tags": [
      "Compte"
    ],
    "summary": "Changer l'espace de travail par défaut"
  },
  "GET /api/workspace": {
    "tags": [
      "Workspace"
    ],
    "summary": "Retourner les paramètres de l'espace de travail courant",
    "description": "Le champ `shotgunApiToken` est toujours masqué (null). Utiliser `shotgunConnected: true` pour vérifier la connexion."
  },
  "GET /api/workspaces": {
    "tags": [
      "Workspace"
    ],
    "summary": "Lister tous les espaces de travail accessibles",
    "description": "Inclut les workspaces dont l'utilisateur est membre ET ceux où il est collaborateur d'événement accepté."
  },
  "POST /api/workspaces": {
    "tags": [
      "Workspace"
    ],
    "summary": "Créer un nouvel espace de travail",
    "description": "L'utilisateur courant devient automatiquement ADMIN du nouvel espace et son `defaultWorkspaceId` est mis à jour."
  },
  "PUT /api/workspace": {
    "tags": [
      "Workspace"
    ],
    "summary": "Mettre à jour les paramètres de l'espace de travail",
    "description": "Seul un ADMIN peut modifier. Si `shotgunApiToken` est omis ou vide, le token existant est conservé."
  },
  "DELETE /api/workspace": {
    "tags": [
      "Workspace"
    ],
    "summary": "Supprimer l'espace de travail (confirmation par nom)",
    "description": "Seul un ADMIN peut supprimer. Si d'autres membres existent, leurs `defaultWorkspaceId` sont migrés vers un autre workspace."
  },
  "GET /api/workspace/invited-events": {
    "tags": [
      "Workspace"
    ],
    "summary": "Lister les événements où l'utilisateur est collaborateur accepté"
  },
  "POST /api/workspace/contacts/transfer": {
    "tags": [
      "Workspace"
    ],
    "summary": "Copier les contacts d'un espace source vers l'espace courant",
    "description": "Fusionne par email ou discordUserId si la personne existe déjà dans l'espace cible."
  },
  "GET /api/workspace/members": {
    "tags": [
      "Membres"
    ],
    "summary": "Lister les membres et invitations en attente"
  },
  "PUT /api/workspace/members/:memberId": {
    "tags": [
      "Membres"
    ],
    "summary": "Modifier le rôle d'un membre",
    "description": "Impossible de modifier le rôle si c'est le dernier ADMIN."
  },
  "DELETE /api/workspace/members/:memberId": {
    "tags": [
      "Membres"
    ],
    "summary": "Retirer un membre",
    "description": "Impossible de retirer le dernier ADMIN ou de se retirer soi-même (utiliser DELETE /api/account)."
  },
  "POST /api/workspace/invitations": {
    "tags": [
      "Membres"
    ],
    "summary": "Inviter un utilisateur dans l'espace de travail",
    "description": "Crée ou renouvelle une invitation valable 7 jours. L'invité reçoit un lien dans le retour (à envoyer manuellement)."
  },
  "POST /api/workspace/invitations/accept": {
    "tags": [
      "Membres"
    ],
    "summary": "Accepter une invitation workspace ou événement"
  },
  "GET /api/people": {
    "tags": [
      "Personnes"
    ],
    "summary": "Lister les personnes de l'espace de travail"
  },
  "GET /api/workspaces/:workspaceId/people": {
    "tags": [
      "Personnes"
    ],
    "summary": "Lister les personnes d'un espace accessible (cross-workspace)",
    "description": "Utilisé par les collaborateurs d'événement pour accéder au répertoire d'un autre workspace."
  },
  "GET /api/people/tags": {
    "tags": [
      "Personnes"
    ],
    "summary": "Lister tous les tags utilisés"
  },
  "GET /api/people/search": {
    "tags": [
      "Personnes"
    ],
    "summary": "Recherche rapide de personnes (max 10 résultats)",
    "description": "Recherche sur nom et email uniquement. Utilisé pour les sélecteurs de personnes dans l'UI."
  },
  "POST /api/people": {
    "tags": [
      "Personnes"
    ],
    "summary": "Créer une personne"
  },
  "GET /api/people/:id": {
    "tags": [
      "Personnes"
    ],
    "summary": "Retourner une personne par son identifiant"
  },
  "PUT /api/people/:id": {
    "tags": [
      "Personnes"
    ],
    "summary": "Mettre à jour une personne"
  },
  "POST /api/people/:id/archive": {
    "tags": [
      "Personnes"
    ],
    "summary": "Archiver une personne (suppression logique)"
  },
  "POST /api/people/:id/restore": {
    "tags": [
      "Personnes"
    ],
    "summary": "Restaurer une personne archivée"
  },
  "GET /api/events": {
    "tags": [
      "Événements"
    ],
    "summary": "Lister les événements de l'espace de travail",
    "description": "Les collaborateurs d'événement ne voient que les événements auxquels ils ont été invités."
  },
  "POST /api/events": {
    "tags": [
      "Événements"
    ],
    "summary": "Créer un événement"
  },
  "GET /api/events/venues": {
    "tags": [
      "Événements"
    ],
    "summary": "Lister les lieux actifs de l'espace de travail"
  },
  "POST /api/events/venues": {
    "tags": [
      "Événements"
    ],
    "summary": "Créer un lieu"
  },
  "GET /api/events/:id": {
    "tags": [
      "Événements"
    ],
    "summary": "Retourner un événement avec ses détails et compteurs"
  },
  "PUT /api/events/:id": {
    "tags": [
      "Événements"
    ],
    "summary": "Mettre à jour un événement",
    "description": "Si `shotgunEventId` change, les tarifs billets Shotgun associés sont supprimés."
  },
  "DELETE /api/events/:id": {
    "tags": [
      "Événements"
    ],
    "summary": "Supprimer un événement et toutes ses données"
  },
  "GET /api/shotgun/events": {
    "tags": [
      "Shotgun"
    ],
    "summary": "Rechercher des événements sur Shotgun"
  },
  "GET /api/events/:eventId/participants": {
    "tags": [
      "Participants"
    ],
    "summary": "Lister les participants d'un événement",
    "description": "Les champs `fee` et `internalNotes` sont masqués selon le rôle (visibles uniquement pour ADMIN, ORGANIZER, TREASURER)."
  },
  "POST /api/events/:eventId/participants": {
    "tags": [
      "Participants"
    ],
    "summary": "Ajouter un participant à un événement",
    "description": "Si le participant a le rôle ARTIST et un cachet (`fee`), une dépense de type 'artistes' est créée automatiquement."
  },
  "PUT /api/events/:eventId/participants/:id": {
    "tags": [
      "Participants"
    ],
    "summary": "Mettre à jour un participant",
    "description": "Met à jour le participant et resynchronise la dépense artiste liée si le cachet change."
  },
  "PUT /api/participants/:id": {
    "tags": [
      "Participants"
    ],
    "summary": "Mettre à jour un participant (accès direct par id)"
  },
  "DELETE /api/events/:eventId/participants/:id": {
    "tags": [
      "Participants"
    ],
    "summary": "Retirer un participant d'un événement"
  },
  "DELETE /api/participants/:id": {
    "tags": [
      "Participants"
    ],
    "summary": "Supprimer un participant (accès direct par id)"
  },
  "GET /api/events/:eventId/participants/persons": {
    "tags": [
      "Participants"
    ],
    "summary": "Lister les personnes participantes (pour sélecteurs UI)"
  },
  "GET /api/events/:eventId/collaborators": {
    "tags": [
      "Participants"
    ],
    "summary": "Lister les collaborateurs externes d'un événement"
  },
  "POST /api/events/:eventId/collaborators": {
    "tags": [
      "Participants"
    ],
    "summary": "Inviter un collaborateur externe sur un événement",
    "description": "Génère un lien d'invitation valable 7 jours. Le collaborateur accède uniquement à cet événement."
  },
  "DELETE /api/events/:eventId/collaborators/:collaboratorId": {
    "tags": [
      "Participants"
    ],
    "summary": "Révoquer l'accès d'un collaborateur externe"
  },
  "GET /calendar/tasks/:token": {
    "tags": [
      "Tâches"
    ],
    "summary": "Flux ICS public des tâches (via token d'abonnement)",
    "description": "Endpoint public sans authentification. Retourne un fichier ICS pour import calendrier."
  },
  "GET /api/events/:eventId/tasks": {
    "tags": [
      "Tâches"
    ],
    "summary": "Lister les tâches d'un événement"
  },
  "GET /api/events/:eventId/tasks/calendar.ics": {
    "tags": [
      "Tâches"
    ],
    "summary": "Télécharger le calendrier ICS des tâches"
  },
  "GET /api/events/:eventId/tasks/calendar-subscription": {
    "tags": [
      "Tâches"
    ],
    "summary": "Obtenir ou créer un token d'abonnement calendrier",
    "description": "Retourne un token permanent permettant d'accéder au flux ICS sans authentification."
  },
  "POST /api/events/:eventId/tasks": {
    "tags": [
      "Tâches"
    ],
    "summary": "Créer une tâche",
    "description": "Si `dueAt` est défini et tombe le même jour que l'événement (heure de Paris), un élément de conducteur est créé automatiquement (`autoRunOfShowItem`)."
  },
  "PUT /api/events/:eventId/tasks/:id": {
    "tags": [
      "Tâches"
    ],
    "summary": "Mettre à jour une tâche",
    "description": "Resynchronise l'élément du conducteur lié si `dueAt` ou `title` change."
  },
  "PUT /api/tasks/:id": {
    "tags": [
      "Tâches"
    ],
    "summary": "Mettre à jour une tâche (accès direct par id)"
  },
  "PATCH /api/events/:eventId/tasks/:id/status": {
    "tags": [
      "Tâches"
    ],
    "summary": "Modifier uniquement le statut d'une tâche"
  },
  "PATCH /api/tasks/:id/status": {
    "tags": [
      "Tâches"
    ],
    "summary": "Modifier le statut d'une tâche (accès direct par id)"
  },
  "DELETE /api/events/:eventId/tasks/:id": {
    "tags": [
      "Tâches"
    ],
    "summary": "Supprimer une tâche",
    "description": "Supprime également l'élément du conducteur lié si présent."
  },
  "DELETE /api/tasks/:id": {
    "tags": [
      "Tâches"
    ],
    "summary": "Supprimer une tâche (accès direct par id)"
  },
  "GET /api/events/:eventId/run-of-show": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Lister les éléments du conducteur"
  },
  "GET /api/events/:eventId/run-of-show/tracks": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Lister les metiers du conducteur"
  },
  "POST /api/events/:eventId/run-of-show/tracks": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Creer un metier du conducteur"
  },
  "PUT /api/run-of-show/tracks/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Mettre a jour un metier du conducteur"
  },
  "DELETE /api/run-of-show/tracks/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Supprimer un metier du conducteur",
    "description": "Les elements rattaches sont conserves et repassent sans metier."
  },
  "GET /api/events/:eventId/run-of-show/sections": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Lister les sections du conducteur"
  },
  "POST /api/events/:eventId/run-of-show/sections": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Creer une section du conducteur"
  },
  "PUT /api/run-of-show/sections/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Mettre a jour une section du conducteur"
  },
  "DELETE /api/run-of-show/sections/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Supprimer une section du conducteur",
    "description": "Les elements rattaches sont conserves et repassent sans section."
  },
  "POST /api/events/:eventId/run-of-show": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Créer un élément du conducteur"
  },
  "PUT /api/events/:eventId/run-of-show/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Mettre à jour un élément du conducteur",
    "description": "Resynchronise la tâche source liée si `title`, `startsAt` ou `responsiblePersonId` change."
  },
  "PUT /api/run-of-show/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Mettre à jour un élément du conducteur (accès direct par id)"
  },
  "DELETE /api/events/:eventId/run-of-show/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Supprimer un élément du conducteur",
    "description": "Supprime également la tâche source liée si présente."
  },
  "DELETE /api/run-of-show/:id": {
    "tags": [
      "Conducteur"
    ],
    "summary": "Supprimer un élément du conducteur (accès direct par id)"
  },
  "GET /api/events/:eventId/expenses": {
    "tags": [
      "Budget"
    ],
    "summary": "Lister les dépenses d'un événement"
  },
  "POST /api/events/:eventId/expenses": {
    "tags": [
      "Budget"
    ],
    "summary": "Créer une dépense"
  },
  "PUT /api/events/:eventId/expenses/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Mettre à jour une dépense",
    "description": "Si la dépense est liée à un participant artiste, met à jour le cachet en conséquence."
  },
  "PUT /api/expenses/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Mettre à jour une dépense (accès direct par id)"
  },
  "DELETE /api/events/:eventId/expenses/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Supprimer une dépense",
    "description": "Si liée à un participant artiste, réinitialise le cachet à null."
  },
  "DELETE /api/expenses/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Supprimer une dépense (accès direct par id)"
  },
  "GET /api/events/:eventId/expenses/persons": {
    "tags": [
      "Budget"
    ],
    "summary": "Lister les personnes éligibles comme payeur de dépense"
  },
  "GET /api/events/:eventId/incomes": {
    "tags": [
      "Budget"
    ],
    "summary": "Lister les revenus d'un événement"
  },
  "POST /api/events/:eventId/incomes": {
    "tags": [
      "Budget"
    ],
    "summary": "Créer un revenu"
  },
  "PUT /api/incomes/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Mettre à jour un revenu"
  },
  "DELETE /api/incomes/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Supprimer un revenu"
  },
  "GET /api/events/:eventId/ticket-tiers": {
    "tags": [
      "Budget"
    ],
    "summary": "Lister les tarifs billets",
    "description": "Tente une synchronisation Shotgun silencieuse avant de retourner les données locales."
  },
  "POST /api/events/:eventId/ticket-tiers": {
    "tags": [
      "Budget"
    ],
    "summary": "Créer un tarif billet manuellement"
  },
  "PUT /api/ticket-tiers/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Mettre à jour un tarif billet"
  },
  "DELETE /api/ticket-tiers/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Supprimer un tarif billet"
  },
  "POST /api/events/:eventId/shotgun/sync": {
    "tags": [
      "Budget"
    ],
    "summary": "Synchroniser les tarifs billets depuis l'API Shotgun",
    "description": "Récupère les deals Shotgun et met à jour les tarifs locaux. Supprime les tarifs qui n'existent plus sur Shotgun."
  },
  "GET /api/events/:eventId/consumables": {
    "tags": [
      "Budget"
    ],
    "summary": "Lister les consommables d'un événement"
  },
  "POST /api/events/:eventId/consumables": {
    "tags": [
      "Budget"
    ],
    "summary": "Créer un consommable"
  },
  "PUT /api/consumables/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Mettre à jour un consommable"
  },
  "DELETE /api/consumables/:id": {
    "tags": [
      "Budget"
    ],
    "summary": "Supprimer un consommable"
  },
  "GET /api/events/:eventId/shopping": {
    "tags": [
      "Courses"
    ],
    "summary": "Lister les articles de courses d'un événement"
  },
  "POST /api/events/:eventId/shopping": {
    "tags": [
      "Courses"
    ],
    "summary": "Créer un article de courses"
  },
  "PUT /api/events/:eventId/shopping/:id": {
    "tags": [
      "Courses"
    ],
    "summary": "Mettre à jour un article de courses"
  },
  "PUT /api/shopping/:id": {
    "tags": [
      "Courses"
    ],
    "summary": "Mettre à jour un article de courses (accès direct par id)"
  },
  "PATCH /api/events/:eventId/shopping/:id/bought": {
    "tags": [
      "Courses"
    ],
    "summary": "Marquer un article comme acheté / non acheté"
  },
  "PATCH /api/shopping/:id/bought": {
    "tags": [
      "Courses"
    ],
    "summary": "Marquer un article comme acheté / non acheté (accès direct par id)"
  },
  "POST /api/events/:eventId/shopping/:id/bought-with-expense": {
    "tags": [
      "Courses"
    ],
    "summary": "Marquer acheté et créer la dépense associée",
    "description": "Crée une dépense catégorie 'courses' et lie l'article à cette dépense."
  },
  "POST /api/shopping/:id/bought-with-expense": {
    "tags": [
      "Courses"
    ],
    "summary": "Marquer acheté et créer la dépense (accès direct par id)"
  },
  "DELETE /api/events/:eventId/shopping/:id": {
    "tags": [
      "Courses"
    ],
    "summary": "Supprimer un article de courses",
    "description": "Supprime également la dépense liée si elle existe."
  },
  "DELETE /api/shopping/:id": {
    "tags": [
      "Courses"
    ],
    "summary": "Supprimer un article de courses (accès direct par id)"
  },
  "GET /api/events/:eventId/shopping/persons": {
    "tags": [
      "Courses"
    ],
    "summary": "Lister les personnes éligibles comme acheteur"
  },
  "GET /api/equipment": {
    "tags": [
      "Matériel"
    ],
    "summary": "Lister les équipements du catalogue"
  },
  "POST /api/equipment": {
    "tags": [
      "Matériel"
    ],
    "summary": "Créer un équipement dans le catalogue"
  },
  "PUT /api/equipment/:id": {
    "tags": [
      "Matériel"
    ],
    "summary": "Mettre à jour un équipement du catalogue"
  },
  "DELETE /api/equipment/:id": {
    "tags": [
      "Matériel"
    ],
    "summary": "Archiver un équipement (suppression logique)"
  },
  "GET /api/events/:eventId/equipment": {
    "tags": [
      "Matériel"
    ],
    "summary": "Lister les usages d'équipement sur un événement"
  },
  "POST /api/events/:eventId/equipment": {
    "tags": [
      "Matériel"
    ],
    "summary": "Ajouter un équipement à un événement",
    "description": "Vérifie les conflits de disponibilité pour les équipements du catalogue (`kind: library`). Une dépense de sync équipement est recalculée automatiquement."
  },
  "PUT /api/events/:eventId/equipment/:usageId": {
    "tags": [
      "Matériel"
    ],
    "summary": "Mettre à jour un usage d'équipement",
    "description": "Vérifie les conflits de disponibilité si la quantité change. Recalcule la dépense de sync équipement."
  },
  "DELETE /api/events/:eventId/equipment/:usageId": {
    "tags": [
      "Matériel"
    ],
    "summary": "Retirer un équipement d'un événement",
    "description": "Recalcule la dépense de sync équipement après suppression."
  },
  "GET /api/events/:eventId/equipment-quotes": {
    "tags": [
      "Matériel"
    ],
    "summary": "Lister les devis d'équipement d'un événement"
  },
  "POST /api/events/:eventId/equipment-quotes": {
    "tags": [
      "Matériel"
    ],
    "summary": "Créer un devis d'équipement"
  },
  "PUT /api/events/:eventId/equipment-quotes/:quoteId": {
    "tags": [
      "Matériel"
    ],
    "summary": "Mettre à jour un devis d'équipement",
    "description": "Recalcule la dépense de sync équipement après modification de la remise."
  },
  "DELETE /api/events/:eventId/equipment-quotes/:quoteId": {
    "tags": [
      "Matériel"
    ],
    "summary": "Supprimer un devis d'équipement",
    "description": "Les usages rattachés au devis sont délié (quoteId → null). Recalcule la dépense de sync."
  },
  "POST /api/events/:eventId/equipment-quotes/:quoteId/file": {
    "tags": [
      "Matériel"
    ],
    "summary": "Attacher un fichier à un devis (PDF, image, Word, max 20 Mo)"
  },
  "POST /api/uploads/expense-receipts": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Uploader un justificatif de dépense",
    "description": "Formats acceptés : PDF, JPEG, PNG, WebP, GIF. Taille max : 8 Mo."
  },
  "POST /api/uploads/event-banners": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Uploader une bannière d'événement",
    "description": "Formats acceptés : JPEG, PNG, WebP, GIF. Taille max : 5 Mo."
  },
  "POST /api/uploads/profile-images": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Uploader une image de profil",
    "description": "Formats acceptés : JPEG, PNG, WebP, GIF. Taille max : 2 Mo."
  },
  "GET /uploads/receipts/:fileName": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Télécharger un justificatif de dépense"
  },
  "GET /uploads/event-banners/:fileName": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Télécharger une bannière d'événement"
  },
  "GET /uploads/equipment-quotes/:fileName": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Télécharger un fichier de devis équipement"
  },
  "GET /uploads/profile-images/:fileName": {
    "tags": [
      "Fichiers"
    ],
    "summary": "Télécharger une image de profil"
  }
};
