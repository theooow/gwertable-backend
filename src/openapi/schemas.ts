/**
 * Documentation OpenAPI centralisée pour tous les endpoints.
 * Injectée via le hook `transform` de @fastify/swagger — sans effet sur la validation Fastify.
 *
 * Clé : `"METHOD /chemin/avec/:params"` (méthode majuscule).
 */

const auth = [{ bearerAuth: [] }];
const pub: [] = [];

// ── Paramètres de chemin ─────────────────────────────────────────────────────

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

// ── Corps de requête partagés ────────────────────────────────────────────────

const roles = ["ADMIN", "ORGANIZER", "TREASURER", "VOLUNTEER", "ARTIST", "VIEWER"] as const;

const personBody = {
  type: "object",
  required: ["fullName"],
  properties: {
    fullName: { type: "string", maxLength: 120 },
    email: { type: "string", format: "email" },
    phone: { type: "string" },
    discordUserId: { type: "string" },
    tags: { type: "array", items: { type: "string" }, maxItems: 20 },
    notes: { type: "string" },
  },
};

const eventBody = {
  type: "object",
  required: ["name", "startsAt"],
  properties: {
    name: { type: "string", maxLength: 120 },
    shotgunEventId: { type: "integer", nullable: true },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    status: { type: "string", enum: ["DRAFT", "PLANNING", "LIVE", "DONE", "ARCHIVED"] },
    description: { type: "string" },
    bannerUrl: { type: "string" },
    venueId: { type: "string" },
    nbCollectifs: { type: "integer", minimum: 1 },
    kegUnitPriceCents: { type: "integer", minimum: 0 },
    avgBasketCents: { type: "integer", minimum: 0 },
  },
};

const participantBody = {
  type: "object",
  required: ["personId", "roles"],
  properties: {
    personId: { type: "string" },
    roles: {
      type: "array",
      items: { type: "string", enum: ["GUEST", "VOLUNTEER", "ARTIST", "STAFF", "SUPPLIER"] },
      minItems: 1,
    },
    rsvpStatus: { type: "string", enum: ["UNKNOWN", "YES", "NO", "MAYBE"] },
    plusOnes: { type: "integer", minimum: 0, maximum: 50 },
    dietary: { type: "string" },
    setStart: { type: "string", format: "date-time" },
    setEnd: { type: "string", format: "date-time" },
    fee: { type: "string", description: "Cachet en euros (ex: '150.00')" },
    contractSigned: { type: "boolean" },
    internalNotes: { type: "string" },
  },
};

const taskBody = {
  type: "object",
  required: ["title", "category"],
  properties: {
    title: { type: "string", maxLength: 120 },
    description: { type: "string" },
    category: { type: "string", maxLength: 160 },
    status: { type: "string", enum: ["TODO", "DOING", "DONE", "BLOCKED"] },
    priority: { type: "string", enum: ["LOW", "MED", "HIGH"] },
    dueAt: { type: "string", format: "date-time" },
    assigneeId: { type: "string" },
  },
};

const taskStatusBody = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string", enum: ["TODO", "DOING", "DONE", "BLOCKED"] } },
};

const runOfShowBody = {
  type: "object",
  required: ["startsAt", "durationMin", "title"],
  properties: {
    trackId: { type: "string", nullable: true },
    startsAt: { type: "string", format: "date-time" },
    durationMin: { type: "integer", minimum: 1, maximum: 1440 },
    title: { type: "string", maxLength: 120 },
    responsible: { type: "string" },
    responsiblePersonId: { type: "string" },
    notes: { type: "string" },
  },
};

const runOfShowTrackBody = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", maxLength: 120 },
    color: { type: "string" },
  },
};

const expenseBody = {
  type: "object",
  required: ["label", "amount", "category"],
  properties: {
    label: { type: "string", maxLength: 120 },
    amount: { type: "string", description: "Montant en euros (ex: '42.50')" },
    category: { type: "string", maxLength: 160 },
    paidById: { type: "string" },
    paidAt: { type: "string", format: "date-time" },
    reimbursement: { type: "string", enum: ["PENDING", "DONE", "NOT_OWED"] },
    receiptUrl: { type: "string" },
    notes: { type: "string" },
  },
};

const incomeBody = {
  type: "object",
  required: ["label", "amountCents", "category"],
  properties: {
    label: { type: "string", maxLength: 120 },
    amountCents: { type: "integer", minimum: 0 },
    category: { type: "string", enum: ["bar", "merch", "caisse", "sponsor", "autre"] },
    receivedAt: { type: "string", format: "date-time" },
  },
};

const ticketTierBody = {
  type: "object",
  required: ["name", "organizerRevenueCents", "publicPriceCents", "quantity"],
  properties: {
    name: { type: "string" },
    organizerRevenueCents: { type: "integer", minimum: 0 },
    publicPriceCents: { type: "integer", minimum: 0 },
    quantity: { type: "integer", minimum: 0 },
    sold: { type: "integer", minimum: 0 },
  },
};

const consumableBody = {
  type: "object",
  required: ["name", "unitPriceCents"],
  properties: {
    name: { type: "string", maxLength: 120 },
    unitPriceCents: { type: "integer", minimum: 0 },
    estimatedQty: { type: "integer", minimum: 0 },
  },
};

const shoppingBody = {
  type: "object",
  required: ["name", "quantity", "category"],
  properties: {
    name: { type: "string", maxLength: 120 },
    quantity: { type: "string", description: "Quantité (décimal accepté, ex: '1.5')" },
    unit: { type: "string" },
    category: { type: "string", maxLength: 160 },
    estimatedCents: { type: "string", description: "Montant estimé en euros (ex: '12.50')" },
    buyerId: { type: "string" },
  },
};

const boughtBody = {
  type: "object",
  required: ["bought"],
  properties: { bought: { type: "boolean" } },
};

const boughtWithExpenseBody = {
  type: "object",
  required: ["amountCents"],
  properties: {
    amountCents: { type: "integer", minimum: 0 },
    paidById: { type: "string", nullable: true },
  },
};

const equipmentItemBody = {
  type: "object",
  required: ["name", "category", "ownership"],
  properties: {
    name: { type: "string", maxLength: 120 },
    category: { type: "string", maxLength: 160 },
    ownership: { type: "string", enum: ["OWNED", "BORROWED", "RENTED"] },
    ownerId: { type: "string", nullable: true },
    unitPriceCents: { type: "integer", minimum: 0 },
    rentalCoef: { type: "number", minimum: 0 },
    quantity: { type: "integer", minimum: 1 },
    notes: { type: "string" },
  },
};

const equipmentUsageCreateBody = {
  type: "object",
  required: ["kind"],
  description: "Utiliser `kind: \"library\"` pour un équipement du catalogue, `kind: \"oneoff\"` pour un équipement ponctuel.",
  properties: {
    kind: { type: "string", enum: ["library", "oneoff"] },
    itemId: { type: "string", description: "Identifiant de l'équipement catalogue (requis si kind=library)" },
    name: { type: "string", description: "Nom libre (requis si kind=oneoff)" },
    category: { type: "string" },
    quantity: { type: "integer", minimum: 1 },
    unitPriceCents: { type: "integer", minimum: 0, description: "Écrase le prix du catalogue si fourni" },
    rentalCoef: { type: "number", minimum: 0, description: "Coefficient de location (1 = prix unitaire)" },
    notes: { type: "string" },
  },
};

const equipmentUsageUpdateBody = {
  type: "object",
  properties: {
    quantity: { type: "integer", minimum: 1 },
    unitPriceCents: { type: "integer", minimum: 0 },
    rentalCoef: { type: "number", minimum: 0 },
    quoteId: { type: "string", nullable: true, description: "Rattacher cet usage à un devis" },
    conditionBefore: { type: "string", nullable: true },
    conditionAfter: { type: "string", nullable: true },
    returned: { type: "boolean" },
    notes: { type: "string" },
  },
};

const equipmentQuoteBody = {
  type: "object",
  required: ["label"],
  properties: {
    label: { type: "string", maxLength: 120 },
    discountCents: { type: "integer", minimum: 0, nullable: true, description: "Remise fixe en centimes (exclusif avec discountPct)" },
    discountPct: { type: "number", minimum: 0, maximum: 100, nullable: true, description: "Remise en % (exclusif avec discountCents)" },
  },
};

const uploadBody = {
  type: "object",
  required: ["fileName", "contentType", "data"],
  properties: {
    fileName: { type: "string", description: "Nom du fichier d'origine" },
    contentType: { type: "string", description: "Type MIME (ex: image/jpeg, application/pdf)" },
    data: { type: "string", description: "Contenu du fichier encodé en base64" },
  },
};

const workspaceSettingsBody = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", maxLength: 120 },
    shotgunOrganizerId: { type: "string" },
    shotgunApiToken: { type: "string", description: "Laissé vide = conserve le token existant" },
  },
};

// ── Type ─────────────────────────────────────────────────────────────────────

type RouteDoc = {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: typeof auth | typeof pub;
  params?: object;
  querystring?: object;
  body?: object;
};

// ── Registre des routes ───────────────────────────────────────────────────────

export const routeDocs: Record<string, RouteDoc> = {
  // ── Système ──────────────────────────────────────────────────────────────────

  "GET /health": {
    tags: ["Système"],
    summary: "Vérification de l'état du serveur",
    security: pub,
  },

  // ── Auth ─────────────────────────────────────────────────────────────────────

  "POST /api/auth/login-link": {
    tags: ["Auth"],
    summary: "Envoyer un lien de connexion par email",
    description: "Génère un token à usage unique et l'envoie par email. Si `inviteToken` est fourni, valide l'invitation avant d'envoyer.",
    security: pub,
    body: {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", format: "email" },
        inviteToken: { type: "string", description: "Token d'invitation workspace ou événement (optionnel)" },
      },
    },
  },
  "POST /api/auth/verify": {
    tags: ["Auth"],
    summary: "Vérifier le token et ouvrir une session",
    description: "Consomme le token (usage unique), crée l'utilisateur si nécessaire, accepte l'invitation si fournie, et retourne un `sessionToken`.",
    security: pub,
    body: {
      type: "object",
      required: ["email", "token"],
      properties: {
        email: { type: "string", format: "email" },
        token: { type: "string" },
        inviteToken: { type: "string", description: "Token d'invitation à accepter lors de la connexion (optionnel)" },
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

  // ── Compte ───────────────────────────────────────────────────────────────────

  "GET /api/account": {
    tags: ["Compte"],
    summary: "Retourner le profil de l'utilisateur courant",
    security: auth,
  },
  "PUT /api/account": {
    tags: ["Compte"],
    summary: "Mettre à jour le profil utilisateur",
    security: auth,
    body: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120 },
        image: { type: "string", maxLength: 2000, description: "URL de l'image de profil" },
      },
    },
  },
  "DELETE /api/account": {
    tags: ["Compte"],
    summary: "Supprimer le compte (confirmation par email)",
    description: "Supprime le compte. Si l'utilisateur est le seul membre de son workspace, supprime aussi le workspace.",
    security: auth,
    body: {
      type: "object",
      required: ["confirm"],
      properties: { confirm: { type: "string", description: "Doit correspondre exactement à l'adresse email du compte" } },
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

  // ── Workspace ────────────────────────────────────────────────────────────────

  "GET /api/workspace": {
    tags: ["Workspace"],
    summary: "Retourner les paramètres de l'espace de travail courant",
    description: "Le champ `shotgunApiToken` est toujours masqué (null). Utiliser `shotgunConnected: true` pour vérifier la connexion.",
    security: auth,
  },
  "GET /api/workspaces": {
    tags: ["Workspace"],
    summary: "Lister tous les espaces de travail accessibles",
    description: "Inclut les workspaces dont l'utilisateur est membre ET ceux où il est collaborateur d'événement accepté.",
    security: auth,
  },
  "POST /api/workspaces": {
    tags: ["Workspace"],
    summary: "Créer un nouvel espace de travail",
    description: "L'utilisateur courant devient automatiquement ADMIN du nouvel espace et son `defaultWorkspaceId` est mis à jour.",
    security: auth,
    body: workspaceSettingsBody,
  },
  "PUT /api/workspace": {
    tags: ["Workspace"],
    summary: "Mettre à jour les paramètres de l'espace de travail",
    description: "Seul un ADMIN peut modifier. Si `shotgunApiToken` est omis ou vide, le token existant est conservé.",
    security: auth,
    body: workspaceSettingsBody,
  },
  "DELETE /api/workspace": {
    tags: ["Workspace"],
    summary: "Supprimer l'espace de travail (confirmation par nom)",
    description: "Seul un ADMIN peut supprimer. Si d'autres membres existent, leurs `defaultWorkspaceId` sont migrés vers un autre workspace.",
    security: auth,
    body: {
      type: "object",
      required: ["confirm"],
      properties: { confirm: { type: "string", description: "Doit correspondre exactement au nom de l'espace de travail" } },
    },
  },
  "GET /api/workspace/invited-events": {
    tags: ["Workspace"],
    summary: "Lister les événements où l'utilisateur est collaborateur accepté",
    security: auth,
  },
  "POST /api/workspace/contacts/transfer": {
    tags: ["Workspace"],
    summary: "Copier les contacts d'un espace source vers l'espace courant",
    description: "Fusionne par email ou discordUserId si la personne existe déjà dans l'espace cible.",
    security: auth,
    body: {
      type: "object",
      required: ["sourceWorkspaceId"],
      properties: {
        sourceWorkspaceId: { type: "string" },
        excludedPersonIds: { type: "array", items: { type: "string" }, description: "Identifiants des personnes à exclure du transfert" },
      },
    },
  },

  // ── Membres ──────────────────────────────────────────────────────────────────

  "GET /api/workspace/members": {
    tags: ["Membres"],
    summary: "Lister les membres et invitations en attente",
    security: auth,
  },
  "PUT /api/workspace/members/:memberId": {
    tags: ["Membres"],
    summary: "Modifier le rôle d'un membre",
    description: "Impossible de modifier le rôle si c'est le dernier ADMIN.",
    security: auth,
    params: pMemberId,
    body: {
      type: "object",
      required: ["role"],
      properties: {
        role: { type: "string", enum: roles },
      },
    },
  },
  "DELETE /api/workspace/members/:memberId": {
    tags: ["Membres"],
    summary: "Retirer un membre",
    description: "Impossible de retirer le dernier ADMIN ou de se retirer soi-même (utiliser DELETE /api/account).",
    security: auth,
    params: pMemberId,
  },
  "POST /api/workspace/invitations": {
    tags: ["Membres"],
    summary: "Inviter un utilisateur dans l'espace de travail",
    description: "Crée ou renouvelle une invitation valable 7 jours. L'invité reçoit un lien dans le retour (à envoyer manuellement).",
    security: auth,
    body: {
      type: "object",
      required: ["email", "role"],
      properties: {
        email: { type: "string", format: "email" },
        role: { type: "string", enum: roles },
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
        search: { type: "string", description: "Recherche sur nom, email, téléphone et tags" },
        tags: { type: "string", description: "Filtrer par tags (séparés par virgule)" },
        includeArchived: { type: "boolean", description: "Inclure les personnes archivées (défaut: false)" },
      },
    },
  },
  "GET /api/workspaces/:workspaceId/people": {
    tags: ["Personnes"],
    summary: "Lister les personnes d'un espace accessible (cross-workspace)",
    description: "Utilisé par les collaborateurs d'événement pour accéder au répertoire d'un autre workspace.",
    security: auth,
    params: pWorkspaceId,
  },
  "GET /api/people/tags": {
    tags: ["Personnes"],
    summary: "Lister tous les tags utilisés",
    security: auth,
  },
  "GET /api/people/search": {
    tags: ["Personnes"],
    summary: "Recherche rapide de personnes (max 10 résultats)",
    description: "Recherche sur nom et email uniquement. Utilisé pour les sélecteurs de personnes dans l'UI.",
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
    body: personBody,
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
    body: personBody,
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
    description: "Les collaborateurs d'événement ne voient que les événements auxquels ils ont été invités.",
    security: auth,
  },
  "POST /api/events": {
    tags: ["Événements"],
    summary: "Créer un événement",
    security: auth,
    body: eventBody,
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
      properties: { name: { type: "string", maxLength: 120 } },
    },
  },
  "GET /api/events/:id": {
    tags: ["Événements"],
    summary: "Retourner un événement avec ses détails et compteurs",
    security: auth,
    params: pId,
  },
  "PUT /api/events/:id": {
    tags: ["Événements"],
    summary: "Mettre à jour un événement",
    description: "Si `shotgunEventId` change, les tarifs billets Shotgun associés sont supprimés.",
    security: auth,
    params: pId,
    body: eventBody,
  },
  "DELETE /api/events/:id": {
    tags: ["Événements"],
    summary: "Supprimer un événement et toutes ses données",
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
      properties: { q: { type: "string", description: "Terme de recherche (nom de l'événement)" } },
    },
  },

  // ── Participants ──────────────────────────────────────────────────────────────

  "GET /api/events/:eventId/participants": {
    tags: ["Participants"],
    summary: "Lister les participants d'un événement",
    description: "Les champs `fee` et `internalNotes` sont masqués selon le rôle (visibles uniquement pour ADMIN, ORGANIZER, TREASURER).",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/participants": {
    tags: ["Participants"],
    summary: "Ajouter un participant à un événement",
    description: "Si le participant a le rôle ARTIST et un cachet (`fee`), une dépense de type 'artistes' est créée automatiquement.",
    security: auth,
    params: pEventId,
    body: participantBody,
  },
  "PUT /api/events/:eventId/participants/:id": {
    tags: ["Participants"],
    summary: "Mettre à jour un participant",
    description: "Met à jour le participant et resynchronise la dépense artiste liée si le cachet change.",
    security: auth,
    params: pEventItem,
    body: participantBody,
  },
  "PUT /api/participants/:id": {
    tags: ["Participants"],
    summary: "Mettre à jour un participant (accès direct par id)",
    security: auth,
    params: pId,
    body: participantBody,
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
    summary: "Lister les personnes participantes (pour sélecteurs UI)",
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
    description: "Génère un lien d'invitation valable 7 jours. Le collaborateur accède uniquement à cet événement.",
    security: auth,
    params: pEventId,
    body: {
      type: "object",
      required: ["email", "role"],
      properties: {
        email: { type: "string", format: "email" },
        role: { type: "string", enum: roles },
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
    summary: "Flux ICS public des tâches (via token d'abonnement)",
    description: "Endpoint public sans authentification. Retourne un fichier ICS pour import calendrier.",
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
    summary: "Télécharger le calendrier ICS des tâches",
    security: auth,
    params: pEventId,
  },
  "GET /api/events/:eventId/tasks/calendar-subscription": {
    tags: ["Tâches"],
    summary: "Obtenir ou créer un token d'abonnement calendrier",
    description: "Retourne un token permanent permettant d'accéder au flux ICS sans authentification.",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/tasks": {
    tags: ["Tâches"],
    summary: "Créer une tâche",
    description: "Si `dueAt` est défini et tombe le même jour que l'événement (heure de Paris), un élément de conducteur est créé automatiquement (`autoRunOfShowItem`).",
    security: auth,
    params: pEventId,
    body: taskBody,
  },
  "PUT /api/events/:eventId/tasks/:id": {
    tags: ["Tâches"],
    summary: "Mettre à jour une tâche",
    description: "Resynchronise l'élément du conducteur lié si `dueAt` ou `title` change.",
    security: auth,
    params: pEventItem,
    body: taskBody,
  },
  "PUT /api/tasks/:id": {
    tags: ["Tâches"],
    summary: "Mettre à jour une tâche (accès direct par id)",
    security: auth,
    params: pId,
    body: taskBody,
  },
  "PATCH /api/events/:eventId/tasks/:id/status": {
    tags: ["Tâches"],
    summary: "Modifier uniquement le statut d'une tâche",
    security: auth,
    params: pEventItem,
    body: taskStatusBody,
  },
  "PATCH /api/tasks/:id/status": {
    tags: ["Tâches"],
    summary: "Modifier le statut d'une tâche (accès direct par id)",
    security: auth,
    params: pId,
    body: taskStatusBody,
  },
  "DELETE /api/events/:eventId/tasks/:id": {
    tags: ["Tâches"],
    summary: "Supprimer une tâche",
    description: "Supprime également l'élément du conducteur lié si présent.",
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
  "GET /api/events/:eventId/run-of-show/tracks": {
    tags: ["Conducteur"],
    summary: "Lister les metiers du conducteur",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/run-of-show/tracks": {
    tags: ["Conducteur"],
    summary: "Creer un metier du conducteur",
    security: auth,
    params: pEventId,
    body: runOfShowTrackBody,
  },
  "PUT /api/run-of-show/tracks/:id": {
    tags: ["Conducteur"],
    summary: "Mettre a jour un metier du conducteur",
    security: auth,
    params: pId,
    body: runOfShowTrackBody,
  },
  "DELETE /api/run-of-show/tracks/:id": {
    tags: ["Conducteur"],
    summary: "Supprimer un metier du conducteur",
    description: "Les elements rattaches sont conserves et repassent sans metier.",
    security: auth,
    params: pId,
  },
  "POST /api/events/:eventId/run-of-show": {
    tags: ["Conducteur"],
    summary: "Créer un élément du conducteur",
    security: auth,
    params: pEventId,
    body: runOfShowBody,
  },
  "PUT /api/events/:eventId/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Mettre à jour un élément du conducteur",
    description: "Resynchronise la tâche source liée si `title`, `startsAt` ou `responsiblePersonId` change.",
    security: auth,
    params: pEventItem,
    body: runOfShowBody,
  },
  "PUT /api/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Mettre à jour un élément du conducteur (accès direct par id)",
    security: auth,
    params: pId,
    body: runOfShowBody,
  },
  "DELETE /api/events/:eventId/run-of-show/:id": {
    tags: ["Conducteur"],
    summary: "Supprimer un élément du conducteur",
    description: "Supprime également la tâche source liée si présente.",
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
    body: expenseBody,
  },
  "PUT /api/events/:eventId/expenses/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour une dépense",
    description: "Si la dépense est liée à un participant artiste, met à jour le cachet en conséquence.",
    security: auth,
    params: pEventItem,
    body: expenseBody,
  },
  "PUT /api/expenses/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour une dépense (accès direct par id)",
    security: auth,
    params: pId,
    body: expenseBody,
  },
  "DELETE /api/events/:eventId/expenses/:id": {
    tags: ["Budget"],
    summary: "Supprimer une dépense",
    description: "Si liée à un participant artiste, réinitialise le cachet à null.",
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
    summary: "Lister les personnes éligibles comme payeur de dépense",
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
    body: incomeBody,
  },
  "PUT /api/incomes/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour un revenu",
    security: auth,
    params: pId,
    body: incomeBody,
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
    summary: "Lister les tarifs billets",
    description: "Tente une synchronisation Shotgun silencieuse avant de retourner les données locales.",
    security: auth,
    params: pEventId,
  },
  "POST /api/events/:eventId/ticket-tiers": {
    tags: ["Budget"],
    summary: "Créer un tarif billet manuellement",
    security: auth,
    params: pEventId,
    body: ticketTierBody,
  },
  "PUT /api/ticket-tiers/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour un tarif billet",
    security: auth,
    params: pId,
    body: ticketTierBody,
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
    description: "Récupère les deals Shotgun et met à jour les tarifs locaux. Supprime les tarifs qui n'existent plus sur Shotgun.",
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
    body: consumableBody,
  },
  "PUT /api/consumables/:id": {
    tags: ["Budget"],
    summary: "Mettre à jour un consommable",
    security: auth,
    params: pId,
    body: consumableBody,
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
    body: shoppingBody,
  },
  "PUT /api/events/:eventId/shopping/:id": {
    tags: ["Courses"],
    summary: "Mettre à jour un article de courses",
    security: auth,
    params: pEventItem,
    body: shoppingBody,
  },
  "PUT /api/shopping/:id": {
    tags: ["Courses"],
    summary: "Mettre à jour un article de courses (accès direct par id)",
    security: auth,
    params: pId,
    body: shoppingBody,
  },
  "PATCH /api/events/:eventId/shopping/:id/bought": {
    tags: ["Courses"],
    summary: "Marquer un article comme acheté / non acheté",
    security: auth,
    params: pEventItem,
    body: boughtBody,
  },
  "PATCH /api/shopping/:id/bought": {
    tags: ["Courses"],
    summary: "Marquer un article comme acheté / non acheté (accès direct par id)",
    security: auth,
    params: pId,
    body: boughtBody,
  },
  "POST /api/events/:eventId/shopping/:id/bought-with-expense": {
    tags: ["Courses"],
    summary: "Marquer acheté et créer la dépense associée",
    description: "Crée une dépense catégorie 'courses' et lie l'article à cette dépense.",
    security: auth,
    params: pEventItem,
    body: boughtWithExpenseBody,
  },
  "POST /api/shopping/:id/bought-with-expense": {
    tags: ["Courses"],
    summary: "Marquer acheté et créer la dépense (accès direct par id)",
    security: auth,
    params: pId,
    body: boughtWithExpenseBody,
  },
  "DELETE /api/events/:eventId/shopping/:id": {
    tags: ["Courses"],
    summary: "Supprimer un article de courses",
    description: "Supprime également la dépense liée si elle existe.",
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
    summary: "Lister les personnes éligibles comme acheteur",
    security: auth,
    params: pEventId,
  },

  // ── Matériel — Catalogue ─────────────────────────────────────────────────────

  "GET /api/equipment": {
    tags: ["Matériel"],
    summary: "Lister les équipements du catalogue",
    security: auth,
  },
  "POST /api/equipment": {
    tags: ["Matériel"],
    summary: "Créer un équipement dans le catalogue",
    security: auth,
    body: equipmentItemBody,
  },
  "PUT /api/equipment/:id": {
    tags: ["Matériel"],
    summary: "Mettre à jour un équipement du catalogue",
    security: auth,
    params: pId,
    body: equipmentItemBody,
  },
  "DELETE /api/equipment/:id": {
    tags: ["Matériel"],
    summary: "Archiver un équipement (suppression logique)",
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
    summary: "Ajouter un équipement à un événement",
    description: "Vérifie les conflits de disponibilité pour les équipements du catalogue (`kind: library`). Une dépense de sync équipement est recalculée automatiquement.",
    security: auth,
    params: pEventId,
    body: equipmentUsageCreateBody,
  },
  "PUT /api/events/:eventId/equipment/:usageId": {
    tags: ["Matériel"],
    summary: "Mettre à jour un usage d'équipement",
    description: "Vérifie les conflits de disponibilité si la quantité change. Recalcule la dépense de sync équipement.",
    security: auth,
    params: pEventUsage,
    body: equipmentUsageUpdateBody,
  },
  "DELETE /api/events/:eventId/equipment/:usageId": {
    tags: ["Matériel"],
    summary: "Retirer un équipement d'un événement",
    description: "Recalcule la dépense de sync équipement après suppression.",
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
    body: equipmentQuoteBody,
  },
  "PUT /api/events/:eventId/equipment-quotes/:quoteId": {
    tags: ["Matériel"],
    summary: "Mettre à jour un devis d'équipement",
    description: "Recalcule la dépense de sync équipement après modification de la remise.",
    security: auth,
    params: pEventQuote,
    body: equipmentQuoteBody,
  },
  "DELETE /api/events/:eventId/equipment-quotes/:quoteId": {
    tags: ["Matériel"],
    summary: "Supprimer un devis d'équipement",
    description: "Les usages rattachés au devis sont délié (quoteId → null). Recalcule la dépense de sync.",
    security: auth,
    params: pEventQuote,
  },
  "POST /api/events/:eventId/equipment-quotes/:quoteId/file": {
    tags: ["Matériel"],
    summary: "Attacher un fichier à un devis (PDF, image, Word, max 20 Mo)",
    security: auth,
    params: pEventQuote,
    body: uploadBody,
  },

  // ── Fichiers ──────────────────────────────────────────────────────────────────

  "POST /api/uploads/expense-receipts": {
    tags: ["Fichiers"],
    summary: "Uploader un justificatif de dépense",
    description: "Formats acceptés : PDF, JPEG, PNG, WebP, GIF. Taille max : 8 Mo.",
    security: auth,
    body: uploadBody,
  },
  "POST /api/uploads/event-banners": {
    tags: ["Fichiers"],
    summary: "Uploader une bannière d'événement",
    description: "Formats acceptés : JPEG, PNG, WebP, GIF. Taille max : 5 Mo.",
    security: auth,
    body: uploadBody,
  },
  "POST /api/uploads/profile-images": {
    tags: ["Fichiers"],
    summary: "Uploader une image de profil",
    description: "Formats acceptés : JPEG, PNG, WebP, GIF. Taille max : 2 Mo.",
    security: auth,
    body: uploadBody,
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
