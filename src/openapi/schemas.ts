/**
 * Documentation OpenAPI centralisée pour tous les endpoints.
 * Injectée via le hook `transform` de @fastify/swagger — sans effet sur la validation Fastify.
 *
 * Clé : `"METHOD /chemin/avec/:params"` (méthode majuscule).
 */

const auth = [{ bearerAuth: [] }];
const pub: [] = [];

/** Paramètre de chemin générique pour un identifiant. */
const pId = { type: "object", properties: { id: { type: "string" } } };
const pMemberId = { type: "object", properties: { memberId: { type: "string" } } };
const pEventId = { type: "object", properties: { eventId: { type: "string" } } };
const pEventItem = { type: "object", properties: { eventId: { type: "string" }, id: { type: "string" } } };
const pEventUsage = { type: "object", properties: { eventId: { type: "string" }, usageId: { type: "string" } } };
const pEventQuote = { type: "object", properties: { eventId: { type: "string" }, quoteId: { type: "string" } } };
const pEventCollaborator = { type: "object", properties: { eventId: { type: "string" }, collaboratorId: { type: "string" } } };
const pToken = { type: "object", properties: { token: { type: "string" } } };
const pFileName = { type: "object", properties: { fileName: { type: "string" } } };
const pWorkspaceId = { type: "object", properties: { workspaceId: { type: "string" } } };

/** Schéma de réponse vide. */
const ok = { type: "object", properties: { ok: { type: "boolean" } } };

type RouteDoc = {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: typeof auth | typeof pub;
  params?: object;
  querystring?: object;
  body?: object;
};

export const routeDocs: Record<string, RouteDoc> = {
  // ── System ──────────────────────────────────────────────────────────────────

  "GET /health": {
    tags: ["Système"],
    summary: "Vérification de l'état du serveur",
    security: pub,
  },

  // ── Auth ─────────────────────────────────────────────────────────────────────

  "POST /api/auth/login-link": {
    tags: ["Auth"],
    summary: "Envoyer un lien de connexion par email",
    security: pub,
    body: {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", format: "email" },
        inviteToken: { type: "string" },
      },
    },
  },
  "POST /api/auth/verify": {
    tags: ["Auth"],
    summary: "Vérifier le token de connexion et ouvrir une session",
    security: pub,
    body: {
      type: "object",
      required: ["email", "token"],
      properties: {
        email: { type: "string", format: "email" },
        token: { type: "string" },
        inviteToken: { type: "string" },
      },
    },
  },
  "GET /api/auth/me": {
    tags: ["Auth"],
    summary: "Retourner l'utilisateur courant",
    security: auth,
  },
  "POST /api/auth/logout": {
    tags: ["Auth"],
    summary: "Invalider la session courante",
    security: auth,
  },

  // ── Compte & Workspace ───────────────────────────────────────────────────────

  "GET /api/account": {
    tags: ["Compte"],
    summary: "Retourner le profil de l'utilisateur courant",
    security: auth,
  },
  "PUT /api/account": {
    tags: ["Compte"],
    summary: "Mettre à jour le profil utilisateur (nom, image)",
    security: auth,
    body: {
      type: "object",
      properties: {
        name: { type: "string" },
        image: { type: "string" },
      },
    },
  },
  "DELETE /api/account": {
    tags: ["Compte"],
    summary: "Supprimer le compte (confirmation par email)",
    security: auth,
    body: {
      type: "object",
      required: ["confirm"],
      properties: { confirm: { type: "string", description: "Doit correspondre à l'email du compte" } },
    },
  },
  "PUT /api/account/workspace": {
    tags: ["Compte"],
    summary: "Changer l'espace de travail par défaut",
    security: auth,
    body: {
      type: "object",
      required: ["workspaceId"],
      properties: { workspaceId: { type: "string" } },
    },
  },

  "GET /api/workspace": {
    tags: ["Workspace"],
    summary: "Retourner les paramètres de l'espace de travail courant",
    security: auth,
  },
  "GET /api/workspaces": {
    tags: ["Workspace"],
    summary: "Lister tous les espaces de travail accessibles par l'utilisateur",
    security: auth,
  },
  "POST /api/workspaces": {
    tags: ["Workspace"],
    summary: "Créer un nouvel espace de travail",
    security: auth,
    body: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        shotgunOrganizerId: { type: "string" },
        shotgunApiToken: { type: "string" },
      },
    },
  },
  "PUT /api/workspace": {
    tags: ["Workspace"],
    summary: "Mettre à jour les paramètres de l'espace de travail",
    security: auth,
    body: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        shotgunOrganizerId: { type: "string" },
        shotgunApiToken: { type: "string" },
      },
    },
  },
  "DELETE /api/workspace": {
    tags: ["Workspace"],
    summary: "Supprimer l'espace de travail (confirmation par nom)",
    security: auth,
    body: {
      type: "object",
      required: ["confirm"],
      properties: { confirm: { type: "string", description: "Doit correspondre au nom de l'espace" } },
    },
  },
  "GET /api/workspace/invited-events": {
    tags: ["Workspace"],
    summary: "Lister les événements auxquels l'utilisateur est collaborateur",
    security: auth,
  },
  "POST /api/workspace/contacts/transfer": {
    tags: ["Workspace"],
    summary: "Copier les contacts d'un espace source vers l'espace courant",
    security: auth,
    body: {
      type: "object",
      required: ["sourceWorkspaceId"],
      properties: {
        sourceWorkspaceId: { type: "string" },
        excludedPersonIds: { type: "array", items: { type: "string" } },
      },
    },
  },

  "GET /api/workspace/members": {
    tags: ["Membres"],
    summary: "Lister les membres et invitations en attente",
    security: auth,
  },
  "PUT /api/workspace/members/:memberId": {
    tags: ["Membres"],
    summary: "Modifier le rôle d'un membre",
    security: auth,
    params: pMemberId,
    body: {
      type: "object",
      required: ["role"],
      properties: {
        role: { type: "string", enum: ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"] },
      },
    },
  },
  "DELETE /api/workspace/members/:memberId": {
    tags: ["Membres"],
    summary: "Retirer un membre de l'espace de travail",
    security: auth,
    params: pMemberId,
  },
  "POST /api/workspace/invitations": {
    tags: ["Membres"],
    summary: "Inviter un utilisateur dans l'espace de travail",
    security: auth,
    body: {
      type: "object",
      required: ["email", "role"],
      properties: {
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"] },
      },
    },
  },
  "POST /api/workspace/invitations/accept": {
    tags: ["Membres"],
    summary: "Accepter une invitation workspace ou événement",
    security: auth,
    body: {
      type: "object",
      required: ["inviteToken"],
      properties: { inviteToken: { type: "string" } },
    },
  },

  // ── Personnes ────────────────────────────────────────────────────────────────

  "GET /api/people": {
    tags: ["Personnes"],
    summary: "Lister les personnes de l'espace de travail",
    security: auth,
    querystring: {
      type: "object",
      properties: {
        search: { type: "string" },
        tags: { type: "string", description: "Tags séparés par virgule" },
        includeArchived: { type: "boolean" },
      },
    },
  },
  "GET /api/workspaces/:workspaceId/people": {
    tags: ["Personnes"],
    summary: "Lister les personnes d'un espace accessible (cross-workspace)",
    security: auth,
    params: pWorkspaceId,
  },
  "GET /api/people/tags": {
    tags: ["Personnes"],
    summary: "Lister tous les tags utilisés dans l'espace de travail",
    security: auth,
  },
  "GET /api/people/search": {
    tags: ["Personnes"],
    summary: "Recherche rapide de personnes (max 10 résultats)",
    security: auth,
    querystring: {
      type: "object",
      properties: { q: { type: "string" } },
    },
  },
  "POST /api/people": {
    tags: ["Personnes"],
    summary: "Créer une personne",
    security: auth,
    body: {
      type: "object",
      required: ["fullName"],
      properties: {
        fullName: { type: "string" },
        email: { type: "string", format: "email" },
        phone: { type: "string" },
        discordUserId: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
    },
  },
  "GET /api/people/:id": {
    tags: ["Personnes"],
    summary: "Retourner une personne par son identifiant",
    security: auth,
    params: pId,
  },
  "PUT /api/people/:id": {
    tags: ["Personnes"],
    summary: "Mettre à jour une personne",
    security: auth,
    params: pId,
    body: {
      type: "object",
      required: ["fullName"],
      properties: {
        fullName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        discordUserId: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
      },
    },
  },
  "POST /api/people/:id/archive": {
    tags: ["Personnes"],
    summary: "Archiver une personne (suppression logique)",
    security: auth,
    params: pId,
  },
  "POST /api/people/:id/restore": {
    tags: ["Personnes"],
    summary: "Restaurer une personne archivée",
    security: auth,
    params: pId,
  },

  // ── Événements ───────────────────────────────────────────────────────────────

  "GET /api/events": {
    tags: ["Événements"],
    summary: "Lister les événements de l'espace de travail",
    security: auth,
  },
  "POST /api/events": {
    tags: ["Événements"],
    summary: "Créer un événement",
    security: auth,
    body: {
      type: "object",
      required: ["name", "startsAt"],
      properties: {
        name: { type: "string" },
        shotgunEventId: { type: "integer" },
        startsAt: { type: "string", format: "date-time" },
        endsAt: { type: "string", format: "date-time" },
        status: { type: "string", enum: ["DRAFT", "PLANNING", "LIVE", "DONE", "ARCHIVED"] },
        description: { type: "string" },
        bannerUrl: { type: "string" },
        venueId: { type: "string" },
        nbCollectifs: { type: "integer" },
        kegUnitPriceCents: { type: "integer" },
        avgBasketCents: { type: "integer" },
      },
    },
  },
  "GET /api/events/venues": {
    tags: ["Événements"],
    summary: "Lister les lieux actifs de l'espace de travail",
    security: auth,
  },
  "POST /api/events/venues": {
    tags: ["Événements"],
    summary: "Créer un lieu",
    security: auth,
    body: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  "GET /api/events/:id": {
    tags: ["Événements"],
    summary: "Retourner un événement avec ses détails",
    security: auth,
    params: pId,
  },
  "PUT /api/events/:id": {
    tags: ["Événements"],
    summary: "Mettre à jour un événement",
    security: auth,
    params: pId,
    body: {
      type: "object",
      required: ["name", "startsAt"],
      properties: {
        name: { type: "string" },
        shotgunEventId: { type: "integer", nullable: true },
        startsAt: { type: "string", format: "date-time" },
        endsAt: { type: "string", format: "date-time" },
        status: { type: "string", enum: ["DRAFT", "PLANNING", "LIVE", "DONE", "ARCHIVED"] },
        description: { type: "string" },
        bannerUrl: { type: "string" },
        venueId: { type: "string" },
        nbCollectifs: { type: "integer" },
        kegUnitPriceCents: { type: "integer" },
        avgBasketCents: { type: "integer" },
      },
    },
  },
  "DELETE /api/events/:id": {
    tags: ["Événements"],
    summary: "Supprimer un événement",
    security: auth,
    params: pId,
  },

  // ── Shotgun ──────────────────────────────────────────────────────────────────

  "GET /api/shotgun/events": {
    tags: ["Shotgun"],
    summary: "Rechercher des événements sur Shotgun",
    security: auth,
    querystring: {
      type: "object",
      properties: { q: { type: "string", description: "Terme de recherche" } },
    },
  },

  // ── Participants ──────────────────────────────────────────────────────────────

  "GET /api/events/:eventId/participants": {
    tags: ["Participants"],
    summary: "Lister les participants d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/participants": {
    tags: ["Participants"],
    summary: "Ajouter un participant à un événement",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["personId", "roles"],
      properties: {
        personId: { type: "string" },
        roles: { type: "array", items: { type: "string", enum: ["GUEST", "VOLUNTEER", "ARTIST", "STAFF", "SUPPLIER"] } },
        rsvpStatus: { type: "string", enum: ["UNKNOWN", "YES", "NO", "MAYBE"] },
        plusOnes: { type: "integer", minimum: 0 },
        dietary: { type: "string" },
        setStart: { type: "string", format: "date-time" },
        setEnd: { type: "string", format: "date-time" },
        fee: { type: "string", description: "Cachet en euros (ex: '150.00')" },
        contractSigned: { type: "boolean" },
        internalNotes: { type: "string" },
      },
    },
  },
  "PUT /api/events/:eventId/participants/:id": {
    tags: ["Participants"],
    summary: "Mettre à jour un participant",
    security: auth,
    params: pEventItem,
  },
  "PUT /api/participants/:id": {
    tags: ["Participants"],
    summary: "Mettre à jour un participant (accès direct par id)",
    security: auth,
    params: pId,
  },
  "DELETE /api/events/:eventId/participants/:id": {
    tags: ["Participants"],
    summary: "Retirer un participant d'un événement",
    security: auth,
    params: pEventItem,
  },
  "DELETE /api/participants/:id": {
    tags: ["Participants"],
    summary: "Supprimer un participant (accès direct par id)",
    security: auth,
    params: pId,
  },
  "GET /api/events/:eventId/participants/persons": {
    tags: ["Participants"],
    summary: "Lister les personnes participantes à un événement",
    security: auth,
    params: pEventId,
  },
  "GET /api/events/:eventId/collaborators": {
    tags: ["Participants"],
    summary: "Lister les collaborateurs externes d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/collaborators": {
    tags: ["Participants"],
    summary: "Inviter un collaborateur externe sur un événement",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["email", "role"],
      properties: {
        email: { type: "string", format: "email" },
        role: { type: "string", enum: ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"] },
      },
    },
  },
  "DELETE /api/events/:eventId/collaborators/:collaboratorId": {
    tags: ["Participants"],
    summary: "Révoquer l'accès d'un collaborateur externe",
    security: auth,
    params: pEventCollaborator,
  },

  // ── Tâches ───────────────────────────────────────────────────────────────────

  "GET /calendar/tasks/:token": {
    tags: ["Tâches"],
    summary: "Flux calendrier ICS public des tâches (via token)",
    security: pub,
    params: pToken,
  },
  "GET /api/events/:eventId/tasks": {
    tags: ["Tâches"],
    summary: "Lister les tâches d'un événement",
    security: auth,
    params: pEventId,
  },
  "GET /api/events/:eventId/tasks/calendar.ics": {
    tags: ["Tâches"],
    summary: "Télécharger le calendrier ICS des tâches d'un événement",
    security: auth,
    params: pEventId,
  },
  "GET /api/events/:eventId/tasks/calendar-subscription": {
    tags: ["Tâches"],
    summary: "Obtenir ou créer un token d'abonnement calendrier",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/tasks": {
    tags: ["Tâches"],
    summary: "Créer une tâche (avec synchronisation conducteur automatique si même jour)",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["title", "category"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        status: { type: "string", enum: ["TODO", "DOING", "DONE", "BLOCKED"] },
        priority: { type: "string", enum: ["LOW", "MED", "HIGH"] },
        dueAt: { type: "string", format: "date-time" },
        assigneeId: { type: "string" },
      },
    },
  },
  "PUT /api/events/:eventId/tasks/:id": {
    tags: ["Tâches"],
    summary: "Mettre à jour une tâche",
    security: auth,
    params: pEventItem,
  },
  "PUT /api/tasks/:id": {
    tags: ["Tâches"],
    summary: "Mettre à jour une tâche (accès direct par id)",
    security: auth,
    params: pId,
  },
  "PATCH /api/events/:eventId/tasks/:id/status": {
    tags: ["Tâches"],
    summary: "Modifier uniquement le statut d'une tâche",
    security: auth,
    params: pEventItem,
    body: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["TODO", "DOING", "DONE", "BLOCKED"] } },
    },
  },
  "PATCH /api/tasks/:id/status": {
    tags: ["Tâches"],
    summary: "Modifier le statut d'une tâche (accès direct par id)",
    security: auth,
    params: pId,
    body: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["TODO", "DOING", "DONE", "BLOCKED"] } },
    },
  },
  "DELETE /api/events/:eventId/tasks/:id": {
    tags: ["Tâches"],
    summary: "Supprimer une tâche (et son élément conducteur lié)",
    security: auth,
    params: pEventItem,
  },
  "DELETE /api/tasks/:id": {
    tags: ["Tâches"],
    summary: "Supprimer une tâche (accès direct par id)",
    security: auth,
    params: pId,
  },

  // ── Conducteur de show ───────────────────────────────────────────────────────

  "GET /api/events/:eventId/run-of-show": {
    tags: ["Conducteur"],
    summary: "Lister les éléments du conducteur",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/run-of-show": {
    tags: ["Conducteur"],
    summary: "Créer un élément du conducteur",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["startsAt", "durationMin", "title"],
      properties: {
        startsAt: { type: "string", format: "date-time" },
        durationMin: { type: "integer", minimum: 1 },
        title: { type: "string" },
        responsible: { type: "string" },
        responsiblePersonId: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  "PUT /api/events/:eventId/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Mettre à jour un élément du conducteur",
    security: auth,
    params: pEventItem,
  },
  "PUT /api/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Mettre à jour un élément du conducteur (accès direct par id)",
    security: auth,
    params: pId,
  },
  "DELETE /api/events/:eventId/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Supprimer un élément du conducteur (et la tâche liée si existante)",
    security: auth,
    params: pEventItem,
  },
  "DELETE /api/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Supprimer un élément du conducteur (accès direct par id)",
    security: auth,
    params: pId,
  },

  // ── Budget — Dépenses ────────────────────────────────────────────────────────

  "GET /api/events/:eventId/expenses": {
    tags: ["Budget"],
    summary: "Lister les dépenses d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/expenses": {
    tags: ["Budget"],
    summary: "Créer une dépense",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["label", "amount", "category"],
      properties: {
        label: { type: "string" },
        amount: { type: "string", description: "Montant en euros (ex: '42.50')" },
        category: { type: "string" },
        paidById: { type: "string" },
        paidAt: { type: "string", format: "date-time" },
        reimbursement: { type: "string", enum: ["PENDING", "DONE", "NOT_OWED"] },
        receiptUrl: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  "PUT /api/events/:eventId/expenses/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour une dépense",
    security: auth,
    params: pEventItem,
  },
  "PUT /api/expenses/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour une dépense (accès direct par id)",
    security: auth,
    params: pId,
  },
  "DELETE /api/events/:eventId/expenses/:id": {
    tags: ["Budget"],
    summary: "Supprimer une dépense",
    security: auth,
    params: pEventItem,
  },
  "DELETE /api/expenses/:id": {
    tags: ["Budget"],
    summary: "Supprimer une dépense (accès direct par id)",
    security: auth,
    params: pId,
  },
  "GET /api/events/:eventId/expenses/persons": {
    tags: ["Budget"],
    summary: "Lister les personnes pouvant être payeurs de dépense",
    security: auth,
    params: pEventId,
  },

  // ── Budget — Revenus ─────────────────────────────────────────────────────────

  "GET /api/events/:eventId/incomes": {
    tags: ["Budget"],
    summary: "Lister les revenus d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/incomes": {
    tags: ["Budget"],
    summary: "Créer un revenu",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["label", "amountCents", "category"],
      properties: {
        label: { type: "string" },
        amountCents: { type: "integer" },
        category: { type: "string", enum: ["bar", "merch", "caisse", "sponsor", "autre"] },
        receivedAt: { type: "string", format: "date-time" },
      },
    },
  },
  "PUT /api/incomes/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour un revenu",
    security: auth,
    params: pId,
  },
  "DELETE /api/incomes/:id": {
    tags: ["Budget"],
    summary: "Supprimer un revenu",
    security: auth,
    params: pId,
  },

  // ── Budget — Billets ─────────────────────────────────────────────────────────

  "GET /api/events/:eventId/ticket-tiers": {
    tags: ["Budget"],
    summary: "Lister les tarifs billets (avec sync Shotgun silencieuse)",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/ticket-tiers": {
    tags: ["Budget"],
    summary: "Créer un tarif billet manuellement",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["name", "organizerRevenueCents", "publicPriceCents", "quantity"],
      properties: {
        name: { type: "string" },
        organizerRevenueCents: { type: "integer" },
        publicPriceCents: { type: "integer" },
        quantity: { type: "integer" },
        sold: { type: "integer" },
      },
    },
  },
  "PUT /api/ticket-tiers/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour un tarif billet",
    security: auth,
    params: pId,
  },
  "DELETE /api/ticket-tiers/:id": {
    tags: ["Budget"],
    summary: "Supprimer un tarif billet",
    security: auth,
    params: pId,
  },
  "POST /api/events/:eventId/shotgun/sync": {
    tags: ["Budget"],
    summary: "Synchroniser les tarifs billets depuis l'API Shotgun",
    security: auth,
    params: pEventId,
  },

  // ── Budget — Consommables ────────────────────────────────────────────────────

  "GET /api/events/:eventId/consumables": {
    tags: ["Budget"],
    summary: "Lister les consommables d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/consumables": {
    tags: ["Budget"],
    summary: "Créer un consommable",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["name", "unitPriceCents"],
      properties: {
        name: { type: "string" },
        unitPriceCents: { type: "integer" },
        estimatedQty: { type: "integer" },
      },
    },
  },
  "PUT /api/consumables/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour un consommable",
    security: auth,
    params: pId,
  },
  "DELETE /api/consumables/:id": {
    tags: ["Budget"],
    summary: "Supprimer un consommable",
    security: auth,
    params: pId,
  },

  // ── Courses ──────────────────────────────────────────────────────────────────

  "GET /api/events/:eventId/shopping": {
    tags: ["Courses"],
    summary: "Lister les articles de courses d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/shopping": {
    tags: ["Courses"],
    summary: "Créer un article de courses",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["name", "quantity", "category"],
      properties: {
        name: { type: "string" },
        quantity: { type: "string" },
        unit: { type: "string" },
        category: { type: "string" },
        estimatedCents: { type: "string" },
        buyerId: { type: "string" },
      },
    },
  },
  "PUT /api/events/:eventId/shopping/:id": {
    tags: ["Courses"],
    summary: "Mettre à jour un article de courses",
    security: auth,
    params: pEventItem,
  },
  "PUT /api/shopping/:id": {
    tags: ["Courses"],
    summary: "Mettre à jour un article de courses (accès direct par id)",
    security: auth,
    params: pId,
  },
  "PATCH /api/events/:eventId/shopping/:id/bought": {
    tags: ["Courses"],
    summary: "Marquer un article comme acheté",
    security: auth,
    params: pEventItem,
    body: {
      type: "object",
      required: ["bought"],
      properties: { bought: { type: "boolean" } },
    },
  },
  "PATCH /api/shopping/:id/bought": {
    tags: ["Courses"],
    summary: "Marquer un article comme acheté (accès direct par id)",
    security: auth,
    params: pId,
    body: {
      type: "object",
      required: ["bought"],
      properties: { bought: { type: "boolean" } },
    },
  },
  "POST /api/events/:eventId/shopping/:id/bought-with-expense": {
    tags: ["Courses"],
    summary: "Marquer un article comme acheté et créer la dépense associée",
    security: auth,
    params: pEventItem,
    body: {
      type: "object",
      required: ["amountCents"],
      properties: {
        amountCents: { type: "integer" },
        paidById: { type: "string", nullable: true },
      },
    },
  },
  "POST /api/shopping/:id/bought-with-expense": {
    tags: ["Courses"],
    summary: "Marquer un article comme acheté avec dépense (accès direct par id)",
    security: auth,
    params: pId,
    body: {
      type: "object",
      required: ["amountCents"],
      properties: {
        amountCents: { type: "integer" },
        paidById: { type: "string", nullable: true },
      },
    },
  },
  "DELETE /api/events/:eventId/shopping/:id": {
    tags: ["Courses"],
    summary: "Supprimer un article de courses",
    security: auth,
    params: pEventItem,
  },
  "DELETE /api/shopping/:id": {
    tags: ["Courses"],
    summary: "Supprimer un article de courses (accès direct par id)",
    security: auth,
    params: pId,
  },
  "GET /api/events/:eventId/shopping/persons": {
    tags: ["Courses"],
    summary: "Lister les personnes pouvant être acheteurs",
    security: auth,
    params: pEventId,
  },

  // ── Matériel — Catalogue ─────────────────────────────────────────────────────

  "GET /api/equipment": {
    tags: ["Matériel"],
    summary: "Lister les équipements du catalogue de l'espace de travail",
    security: auth,
  },
  "POST /api/equipment": {
    tags: ["Matériel"],
    summary: "Créer un équipement dans le catalogue",
    security: auth,
    body: {
      type: "object",
      required: ["name", "category", "ownership"],
      properties: {
        name: { type: "string" },
        category: { type: "string" },
        ownership: { type: "string", enum: ["OWNED", "BORROWED", "RENTED"] },
        ownerId: { type: "string", nullable: true },
        unitPriceCents: { type: "integer" },
        rentalCoef: { type: "number" },
        quantity: { type: "integer" },
        notes: { type: "string" },
      },
    },
  },
  "PUT /api/equipment/:id": {
    tags: ["Matériel"],
    summary: "Mettre à jour un équipement du catalogue",
    security: auth,
    params: pId,
  },
  "DELETE /api/equipment/:id": {
    tags: ["Matériel"],
    summary: "Archiver un équipement du catalogue",
    security: auth,
    params: pId,
  },

  // ── Matériel — Usages événement ──────────────────────────────────────────────

  "GET /api/events/:eventId/equipment": {
    tags: ["Matériel"],
    summary: "Lister les usages d'équipement sur un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/equipment": {
    tags: ["Matériel"],
    summary: "Ajouter un équipement à un événement (catalogue ou one-off)",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["library", "oneoff"] },
        itemId: { type: "string", description: "Requis si kind=library" },
        name: { type: "string", description: "Requis si kind=oneoff" },
        category: { type: "string" },
        quantity: { type: "integer", minimum: 1 },
        unitPriceCents: { type: "integer" },
        rentalCoef: { type: "number" },
        notes: { type: "string" },
      },
    },
  },
  "PUT /api/events/:eventId/equipment/:usageId": {
    tags: ["Matériel"],
    summary: "Mettre à jour un usage d'équipement",
    security: auth,
    params: pEventUsage,
    body: {
      type: "object",
      properties: {
        quantity: { type: "integer" },
        unitPriceCents: { type: "integer" },
        rentalCoef: { type: "number" },
        quoteId: { type: "string", nullable: true },
        conditionBefore: { type: "string", nullable: true },
        conditionAfter: { type: "string", nullable: true },
        returned: { type: "boolean" },
        notes: { type: "string" },
      },
    },
  },
  "DELETE /api/events/:eventId/equipment/:usageId": {
    tags: ["Matériel"],
    summary: "Retirer un équipement d'un événement",
    security: auth,
    params: pEventUsage,
  },

  // ── Matériel — Devis ─────────────────────────────────────────────────────────

  "GET /api/events/:eventId/equipment-quotes": {
    tags: ["Matériel"],
    summary: "Lister les devis d'équipement d'un événement",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/equipment-quotes": {
    tags: ["Matériel"],
    summary: "Créer un devis d'équipement",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["label"],
      properties: {
        label: { type: "string" },
        discountCents: { type: "integer", nullable: true },
        discountPct: { type: "number", nullable: true },
      },
    },
  },
  "PUT /api/events/:eventId/equipment-quotes/:quoteId": {
    tags: ["Matériel"],
    summary: "Mettre à jour un devis d'équipement",
    security: auth,
    params: pEventQuote,
  },
  "DELETE /api/events/:eventId/equipment-quotes/:quoteId": {
    tags: ["Matériel"],
    summary: "Supprimer un devis d'équipement",
    security: auth,
    params: pEventQuote,
  },
  "POST /api/events/:eventId/equipment-quotes/:quoteId/file": {
    tags: ["Matériel"],
    summary: "Attacher un fichier (PDF, image, Word) à un devis",
    security: auth,
    params: pEventQuote,
    body: {
      type: "object",
      required: ["fileName", "contentType", "data"],
      properties: {
        fileName: { type: "string" },
        contentType: { type: "string" },
        data: { type: "string", description: "Contenu du fichier encodé en base64" },
      },
    },
  },

  // ── Fichiers ──────────────────────────────────────────────────────────────────

  "POST /api/uploads/expense-receipts": {
    tags: ["Fichiers"],
    summary: "Uploader un justificatif de dépense (PDF, image, max 8 Mo)",
    security: auth,
    body: {
      type: "object",
      required: ["fileName", "contentType", "data"],
      properties: {
        fileName: { type: "string" },
        contentType: { type: "string" },
        data: { type: "string", description: "Contenu encodé en base64" },
      },
    },
  },
  "POST /api/uploads/event-banners": {
    tags: ["Fichiers"],
    summary: "Uploader une bannière d'événement (image, max 5 Mo)",
    security: auth,
    body: {
      type: "object",
      required: ["fileName", "contentType", "data"],
      properties: {
        fileName: { type: "string" },
        contentType: { type: "string" },
        data: { type: "string", description: "Contenu encodé en base64" },
      },
    },
  },
  "POST /api/uploads/profile-images": {
    tags: ["Fichiers"],
    summary: "Uploader une image de profil (image, max 2 Mo)",
    security: auth,
    body: {
      type: "object",
      required: ["fileName", "contentType", "data"],
      properties: {
        fileName: { type: "string" },
        contentType: { type: "string" },
        data: { type: "string", description: "Contenu encodé en base64" },
      },
    },
  },
  "GET /uploads/receipts/:fileName": {
    tags: ["Fichiers"],
    summary: "Télécharger un justificatif de dépense",
    security: pub,
    params: pFileName,
  },
  "GET /uploads/event-banners/:fileName": {
    tags: ["Fichiers"],
    summary: "Télécharger une bannière d'événement",
    security: pub,
    params: pFileName,
  },
  "GET /uploads/equipment-quotes/:fileName": {
    tags: ["Fichiers"],
    summary: "Télécharger un fichier de devis équipement",
    security: pub,
    params: pFileName,
  },
  "GET /uploads/profile-images/:fileName": {
    tags: ["Fichiers"],
    summary: "Télécharger une image de profil",
    security: pub,
    params: pFileName,
  },
};
