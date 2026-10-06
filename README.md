# Abregi Backend

API REST pour la plateforme Abregi — gestion d'événements, participants, bénévoles, budget, comptabilité, matériel et conducteur de show.

## Sommaire

- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Variables d'environnement](#variables-denvironnement)
- [Commandes](#commandes)
- [Authentification](#authentification)
- [Documentation API](#documentation-api)
- [Domaines fonctionnels](#domaines-fonctionnels)
- [Structure du projet](#structure-du-projet)
- [Tests](#tests)
- [Base de données](#base-de-données)
- [Déploiement](#déploiement)

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Runtime | Node.js 20+ |
| Framework HTTP | [Fastify](https://fastify.dev) 5 |
| ORM | [Prisma](https://www.prisma.io) 6 |
| Base de données | PostgreSQL |
| Validation | [Zod](https://zod.dev) 4 |
| Langage | TypeScript 6 (strict) |
| Emails | Nodemailer |
| PDF | PDFKit (conventions de bénévolat, comptes annuels) |
| Extraction de documents | OpenAI ou Ollama |
| Documentation | OpenAPI 3.0 / Swagger UI |

---

## Architecture

Le backend suit le **patron Repository** avec une séparation claire en couches :

```
Requête HTTP
    ↓
Controller (routes/)      — parsing req/rep, codes HTTP, sécurité CORS
    ↓
Service (services/)       — logique métier, contrôle des permissions
    ↓
Repository (repositories/) — requêtes domaine-spécifiques, orchestration
    ↓
DAO (dao/)                — accès direct à Prisma, CRUD par modèle
    ↓
Prisma / PostgreSQL
```

**DTOs** (`dto/`) — types de réponse publics découplés des modèles Prisma internes.

**Erreurs typées** (`lib/errors.ts`) — `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `ConflictError`, `ValidationError`, `EmailDeliveryError`, toutes héritant de `AppError`.

---

## Prérequis

- Node.js ≥ 20
- PostgreSQL (ou une URL de connexion distante)
- Un serveur SMTP pour les emails (MailHog recommandé en développement)

---

## Installation

```bash
# 1. Cloner le dépôt
git clone <url-du-repo>
cd gwertable-backend

# 2. Installer les dépendances
npm install

# 3. Copier et compléter la configuration
cp .env.example .env

# 4. Générer le client Prisma
npm run db:generate

# 5. Appliquer les migrations
npm run db:migrate

# 6. Démarrer le serveur en mode développement
npm run dev
```

L'API démarre par défaut sur **`http://localhost:4000`**.  
La documentation Swagger est accessible sur **`http://localhost:4000/docs`**.

### MailHog (emails en développement)

```bash
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

Interface web MailHog : `http://localhost:8025`

---

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `DATABASE_URL` | — | URL de connexion PostgreSQL (obligatoire) |
| `PORT` | `4000` | Port d'écoute du serveur |
| `HOST` | `0.0.0.0` | Adresse d'écoute |
| `CORS_ORIGIN` | `http://localhost:3000` | Origines CORS autorisées |
| `FRONTEND_URL` | `http://localhost:3001` | URL de base du frontend (liens dans les emails) |
| `AUTH_TOKEN_TTL_MINUTES` | `15` | Durée de validité des tokens de connexion (max 15 min) |
| `SESSION_TTL_DAYS` | `30` | Durée de vie des sessions |
| `MAIL_TRANSPORT` | `smtp` (`log` en test) | Transport email : `smtp` ou `log` |
| `MAIL_FROM` | `Abregi <no-reply@abregi.local>` | Expéditeur des emails |
| `SMTP_HOST` | `127.0.0.1` | Hôte SMTP |
| `SMTP_PORT` | `1025` | Port SMTP |
| `SMTP_SECURE` | `false` | TLS SMTP |
| `SMTP_USER` | — | Identifiant SMTP (optionnel) |
| `SMTP_PASSWORD` | — | Mot de passe SMTP (optionnel) |
| `DOCUMENT_AI_PROVIDER` | `openai` | Fournisseur IA d'import de documents et d'affectation des bénévoles : `openai` ou `ollama` |
| `OPENAI_API_KEY` | — | Clé API OpenAI |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Modèle OpenAI |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | URL du serveur Ollama |
| `OLLAMA_MODEL` | `llava` | Modèle Ollama |
| `DISCORD_BOT_TOKEN` | — | Token du bot Discord par défaut pour les notifications |
| `WHATSAPP_ACCESS_TOKEN` | — | Token de l'API WhatsApp Cloud |
| `WHATSAPP_PHONE_NUMBER_ID` | — | Identifiant du numéro WhatsApp émetteur |
| `WHATSAPP_TEMPLATE_NAME` | — | Modèle de message WhatsApp |
| `WHATSAPP_TEMPLATE_LANGUAGE` | `fr` | Langue du modèle WhatsApp |
| `NOTIFICATION_WORKER_ENABLED` | `true` en production, `false` sinon | Active le worker de rappels |
| `NOTIFICATION_WORKER_INTERVAL_MS` | `60000` | Intervalle du worker de rappels |
| `NOTIFICATION_REMINDER_LOOKBACK_MINUTES` | `5` | Fenêtre de rattrapage des rappels |
| `SUPER_PDP_CLIENT_ID` / `SUPER_PDP_CLIENT_SECRET` | — | Identifiants OAuth Super PDP (facturation électronique) |
| `SUPER_PDP_AUTHORIZATION_URL` / `SUPER_PDP_TOKEN_URL` | URLs Super PDP | Endpoints OAuth Super PDP |
| `SUPER_PDP_REDIRECT_URI` | `https://www.abregi.com/api/integrations/super-pdp/oauth/callback` | URL de retour OAuth |
| `SUPER_PDP_SCOPES` | — | Scopes OAuth demandés |
| `PDP_CREDENTIAL_ENCRYPTION_KEY` | — | Clé de chiffrement des tokens OAuth (32 octets base64 ou 64 caractères hex) |
| `DISABLE_ERD` | — | `true` désactive la génération du diagramme ERD (CI, Docker) |

---

## Commandes

```bash
# Développement (rechargement automatique)
npm run dev

# Build TypeScript
npm run build

# Démarrer la build de production
npm run start

# Vérification de types
npm run typecheck
npm run typecheck:tests    # types des fichiers de test

# Tests (Node.js test runner natif)
npm run test
npm run test:swagger-ui    # essais navigateur de Swagger UI (Puppeteer)

# Base de données
npm run db:generate        # régénère le client Prisma après un changement de schéma
npm run db:erd             # régénère docs/erd.svg
npm run db:migrate         # applique les migrations en développement
npm run db:deploy          # applique les migrations en production (sans prompt)
npm run db:studio          # ouvre Prisma Studio (UI de la base)
```

---

## Authentification

L'API combine **mot de passe** et **code / lien envoyé par email**.

### Flux de connexion

```
1. POST /api/auth/login-options   { email }
   → compte avec mot de passe : { hasPassword: true, accountName }
   → sinon : envoie un email (code à 6 chiffres + lien), { hasPassword: false, codeSent: true }

2a. POST /api/auth/password/login { email, password }
2b. POST /api/auth/verify-code    { email, code }
2c. POST /api/auth/verify         { email, token }       (lien de l'email)
   → crée une session et retourne { sessionToken, expires, user }
   → pour un nouvel email, fournit le jeton d'inscription

3. POST /api/auth/register        { email, password, registrationToken, acceptTerms: true, … }
   → crée le compte (profil, société, préférences), enregistre l'acceptation des CGU et ouvre une session

4. Toutes les requêtes authentifiées :
   Authorization: Bearer <sessionToken>
   (ou cookie abregi_session=<sessionToken>)

5. POST /api/auth/logout
   → invalide la session
```

`POST /api/auth/password/setup` définit un mot de passe à partir d'un token reçu par email. `POST /api/auth/login-link` renvoie un email de connexion. `GET /api/auth/me` retourne l'utilisateur courant, dont `termsAccepted` (faux tant que la version courante des CGU, définie dans `src/lib/terms.ts`, n'a pas été acceptée). `POST /api/auth/terms/accept` enregistre cette acceptation.

### Invitations

Un `inviteToken` optionnel peut être fourni aux routes de connexion et d'inscription pour rejoindre un espace de travail ou accepter une invitation à un événement.

### Routes publiques

Sans authentification : `/health`, `/docs`, les routes de connexion et d'inscription (sauf `/me` et `/logout`), les portails bénévoles `/api/public/volunteers/*`, la mesure d'audience de la page d'accueil `/api/public/tracking/landing`, l'essai du dashboard budget `/api/public/budget-trial/*`, l'abonnement calendrier `/calendar/tasks/:token` et la lecture des fichiers `/uploads/*` (hors documents de contacts).

### Multi-tenant

L'API est multi-tenant : chaque utilisateur appartient à un ou plusieurs **espaces de travail** (`Workspace`). Toutes les données sont isolées par `workspaceId`.

Les **collaborateurs d'événement** (`EventCollaborator`) ont un accès limité à des événements spécifiques sans être membres de l'espace de travail.

---

## Documentation API

La documentation OpenAPI 3.0 est générée automatiquement et disponible à deux endroits :

| Format | URL |
|--------|-----|
| Interface Swagger UI | `http://localhost:4000/docs` |
| Spécification JSON | `http://localhost:4000/docs/json` |

Toutes les routes applicatives sont documentées (226 opérations), avec leurs paramètres, leur authentification et les schémas de saisie issus des validateurs Zod.

Les corps de requête se remplissent dans des formulaires : listes de choix, nombres, dates, objets imbriqués et tableaux avec ajout/suppression de lignes. Cochez les champs facultatifs à envoyer ; les autres sont omis. Les uploads disposent d'un sélecteur de fichier qui prépare automatiquement le contenu base64 attendu par l'API.

Les essais utilisent le serveur qui héberge Swagger. Connectez-vous dans la rubrique Auth pour obtenir une session navigateur, ou utilisez **Authorize** avec un token Bearer. Les opérations exécutées ont leurs effets réels (emails, factures, suppressions).

Pour documenter une nouvelle route, ajoutez son titre et son domaine dans `src/openapi/schemas.ts` ou `additional.ts`, puis référencez les mêmes validateurs que son handler dans `config.documentation` (`body`, `params`, `querystring`). Ces métadonnées ne modifient pas la validation ni la sérialisation de l'API. `tests/swagger.test.ts` échoue si une route n'a pas d'opération documentée (résumé, tag, `operationId`, sécurité, paramètres, corps et query) ou si la spécification contient des opérations orphelines : toute route ajoutée ou modifiée doit être documentée dans le même commit.

Vérification : `node --import tsx --import ./tests/setup-env.ts --test tests/swagger.test.ts`, puis `npm run test:swagger-ui` pour les essais navigateur sans base de données ni actions métier. Définissez `CHROME_PATH` si vous souhaitez utiliser un navigateur déjà installé.

---

## Domaines fonctionnels

### Espaces de travail & membres
Gestion multi-tenant : création d'espaces, gestion des membres avec rôles (`ADMIN`, `ORGANIZER`, `TREASURER`, `VOLUNTEER`, `ARTIST`, `VIEWER`), invitations par email, transfert de contacts entre espaces, logo et couleur des emails, identité légale de la structure (émetteur des conventions). La matrice des permissions par rôle est définie dans `lib/permissions.ts`.

### Compte & offres
Profil, préférences (thème, langue, devise, fuseau horaire), espace actif et suppression du compte. Chaque utilisateur dispose d'une offre (`BETA_TEST`, `PLATINIUM`) qui conditionne l'import de documents par IA et les notifications WhatsApp (`lib/usage-plans.ts`).

### Personnes
Répertoire de contacts partagé dans l'espace de travail. Recherche par nom/email/téléphone/tags, documents et historique de notes par contact, archivage logique.

### Événements
CRUD d'événements avec gestion des lieux. Deux modes d'accès : membres de l'espace (accès complet) ou collaborateurs externes (accès limité à leurs événements).

### Participants
Ajout de personnes du répertoire à un événement avec rôles (`GUEST`, `VOLUNTEER`, `ARTIST`, `STAFF`, `SUPPLIER`), RSVP, informations de set (artistes), cachet avec synchronisation automatique de la dépense associée (prévisionnelle tant que le cachet est « à rembourser », réelle une fois réglé).

### Collaborateurs d'événement
Invitation d'utilisateurs externes sur un événement spécifique via un lien unique, sans compte dans l'espace de travail.

### Bénévoles
Formulaire public d'inscription, candidatures à valider, postes et créneaux, repas (catering) et réservations, affectations (manuelles ou proposées par IA), badges et pointage, emails envoyés par un worker dédié. Chaque bénévole dispose d'un portail personnel (planning, demandes d'échange de créneaux) et signe sa convention de bénévolat en ligne (PDF). Voir [`docs/volunteers.md`](docs/volunteers.md) et [`docs/volunteer-contracts.md`](docs/volunteer-contracts.md).

### Tâches & conducteur de show
Gestion des tâches par événement avec statuts, priorités, catégories, assignés, commentaires et pièces jointes. Conducteur de show organisé en pistes et sections, avec dépendances entre éléments. Synchronisation bidirectionnelle tâche ↔ élément du conducteur de show (si la tâche est planifiée le même jour que l'événement). Export calendrier ICS avec abonnement via token public.

### Notifications & activité
Paramètres de notification par événement (email, Discord, WhatsApp) et rappels envoyés par un worker périodique. Fil d'activité de l'espace, notifications in-app et préférences par utilisateur.

Le fil couvre toutes les actions métier : événements, tâches, budget (y compris imports et synchronisation Shotgun), courses, participants et collaborateurs, conducteur, matériel (événement et catalogue), bénévoles (candidatures, plannings, échanges, pointage, repas, conventions), contacts, équipe et exercices comptables. Le catalogue des types, leur catégorie, la permission requise pour les lire et la préférence qui filtre leurs notifications sont centralisés dans `lib/activity-catalog.ts`. Les routes enregistrent l'activité via `lib/activity-recorder.ts`, sans jamais faire échouer l'action si l'écriture du fil échoue.

- `GET /api/activity?category=&eventId=&cursor=&limit=` ne renvoie que les catégories autorisées par le rôle ; un collaborateur d'événement ne voit que les événements auxquels il est invité. Pagination par `nextCursor`.
- Les notifications in-app ne sont créées que pour les membres autorisés à lire la catégorie, selon leurs préférences (tâches, échéances, budget, matériel, bénévoles).
- `POST /api/activity/notifications/:id/read` marque une notification, `POST /api/activity/mark-read` les marque toutes.

### Budget
- **Dépenses** : avec rattachement de justificatifs, catégories libres, TVA, suivi des remboursements et notes de frais
- **Revenus** : catégories prédéfinies (bar, merch, caisse, sponsor, autre), justificatifs
- **Import de documents** : prévisualisation puis confirmation des dépenses et revenus extraits par IA
- **Tarifs billets** : manuels ou synchronisés depuis l'API Shotgun
- **Consommables** : articles avec prix unitaire et quantité estimée
- **Collectifs** : collectifs co-organisateurs avec leurs membres (participants de l'événement, un collectif max par participant) et mode de partage du résultat (`EQUAL`, `PRO_RATA_INVESTMENT`, `CUSTOM` avec parts en points de base), avec option de remboursement prioritaire des mises (`stakesFirst`)

### Comptabilité
Exercices comptables de l'espace : états financiers, clôture, export FEC et comptes annuels en PDF. Compte de résultat par événement.

### Courses
Liste de courses collaborative avec statut acheté/non acheté, création automatique d'une dépense lors de l'achat.

### Matériel
Catalogue d'équipements de l'espace de travail avec photos, groupes et TVA, gestion des conflits de disponibilité (chevauchement d'événements). Usages one-off ou depuis le catalogue, import en masse ou depuis un document (IA). Devis avec remise et attachement de fichiers. Synchronisation automatique des dépenses équipement.

### Intégration Shotgun
Synchronisation des tarifs billets depuis l'API Shotgun (billetterie) : récupération des deals, comptage des ventes.

### Administration
Journal des appels API, vue d'ensemble, KPI et gestion des offres utilisateurs, réservés à l'administrateur de la plateforme. Voir [`docs/admin-journal.md`](docs/admin-journal.md).

`GET /api/admin/funnel?period=30|90|365|all` calcule le funnel AARRR du budget sur la cohorte des comptes créés pendant la période (administrateur exclu) :
- **Acquisition** : visites des landings, puis pour la landing budget : email laissé, dashboard d'essai rempli, essai transformé en compte (comptés par adresse) ; enfin comptes créés, ventilés par source (première visite liée au compte, sinon `inconnue`)
- **Activation** : email vérifié → premier événement → budget ouvert → première ligne → budget complet (dépense manuelle + recette ou tarif). Atteindre une étape implique les précédentes.
- **Rétention** : retour sur le budget un autre jour, à 7 j et à 30 j de la première ligne ; `eligible` ne compte que les comptes ayant eu ce délai
- **Referral** : invitation de membre ou de collaborateur, puis invitation acceptée
- **Revenue (proxy)** : export du budget ou de la compta, budget sur 2 événements ou plus

Les étapes métier sont lues dans `ActivityEntry` (historique complet) ; visites, ouvertures, simulations et exports dans `TrackingEvent` (depuis `trackingSince`).

### Essai du budget
Parcours de la landing `/budget-evenement` : un prospect laisse son email (non vérifié, sans code) et obtient un jeton d'essai (`BudgetLead`, une ligne par essai).
- `POST /api/public/budget-trial` démarre l'essai ; `GET`/`PUT /api/public/budget-trial/:token` reprend et enregistre les informations saisies (tarif, jauge, salle, artistes, technique & communication, panier bar)
- `POST /api/public/budget-trial/:token/unsubscribe` arrête les rappels pour cette adresse
- `POST /api/budget-trial/:token/claim` (authentifié, idempotent) crée le premier événement avec un tarif, les dépenses prévisionnelles et le panier moyen, puis marque l'essai converti

Un worker (toutes les 15 min) envoie **un seul rappel par adresse** « Vous n’avez pas finalisé votre création de compte », 24 h après l'essai le plus récent, s'il n'y a ni compte, ni conversion, ni désinscription. Les essais de plus de 7 jours ne sont jamais relancés. L'email contient un lien de reprise et un lien de désinscription (`List-Unsubscribe`).

### Suivi produit
Signaux d'usage qu'aucune table métier n'enregistre, stockés dans `TrackingEvent` sans clé étrangère :
- `POST /api/public/tracking/landing` (public) : visite anonyme de la page d'accueil, avec sa source (`utm_*` ou hôte du référent, jamais l'URL complète)
- `POST /api/tracking/events` (authentifié) : `app_opened`, `budget_viewed`, `budget_simulated`, `budget_exported`. Les signaux de l'administrateur de la plateforme sont ignorés.

### Uploads
Les fichiers sont envoyés en base64 dans un corps JSON.
- Justificatifs de dépenses et de revenus, devis équipement (PDF, images, max 20 Mo)
- Pièces jointes de tâches (max 12 Mo)
- Documents de contacts (max 8 Mo)
- Bannières d'événements (images, max 5 Mo)
- Images de profil et logos d'espace (images, max 2 Mo)

---

## Structure du projet

```
src/
├── app.ts                        # Bootstrap Fastify + enregistrement des plugins et routes
├── server.ts                     # Point d'entrée, listen, workers + graceful shutdown
├── env.ts                        # Validation et typage des variables d'environnement
├── prisma.ts                     # Singleton PrismaClient
│
├── plugins/
│   ├── api-logs.ts               # Journal des appels API (administration)
│   ├── auth.ts                   # Middleware de session, routes publiques
│   ├── errors.ts                 # Gestionnaire d'erreurs centralisé
│   └── swagger.ts                # Plugin OpenAPI 3.0 / Swagger UI
│
├── lib/                          # Helpers transverses : erreurs, permissions, offres, comptabilité,
│                                 # calendrier ICS, emails, Discord, WhatsApp, Shotgun, chiffrement…
│
├── dao/                          # Data Access Objects — une classe par modèle Prisma
├── repositories/                 # Requêtes domaine-spécifiques, orchestration des DAOs
├── services/                     # Logique métier, contrôle des permissions, génération PDF
├── dto/                          # Types de réponse publics (découplés de Prisma)
├── schemas/                      # Schémas Zod de validation des entrées
│
├── openapi/
│   ├── schemas.ts                # Titres et domaines des opérations documentées
│   ├── additional.ts             # Documentation des routes complémentaires
│   ├── contracts.ts              # Schémas de réponse partagés
│   └── forms.ts                  # Formulaires Swagger UI (corps de requête, uploads)
│
├── workers/
│   ├── notification-worker.ts    # Rappels de notifications
│   └── volunteer-email-worker.ts # Envoi des emails bénévoles
│
└── routes/
    ├── health.ts
    ├── auth.ts
    ├── admin.ts
    ├── accounting.ts
    ├── activity.ts
    ├── events.ts
    ├── event-modules.ts
    ├── people.ts
    ├── workspace.ts
    ├── equipment.ts
    ├── shotgun.ts
    ├── volunteer-contracts.ts
    └── event-modules/
        ├── participants.ts
        ├── volunteers.ts
        ├── tasks.ts
        ├── run-of-show.ts
        ├── notifications.ts
        ├── budget.ts
        ├── shopping.ts
        ├── equipment-event.ts
        └── uploads.ts

prisma/
├── schema.prisma                 # Source de vérité du modèle de données
└── migrations/

docs/                             # ERD et documentation fonctionnelle

tests/
├── helpers.ts                    # Utilitaires de test (setup, reset DB, seeders)
├── setup-env.ts                  # Configuration de l'environnement de test
├── browser/swagger-ui.mjs        # Essais navigateur de Swagger UI
└── *.test.ts                     # Tests par domaine
```

---

## Tests

La suite de tests utilise le **runner natif Node.js** (`node:test`), sans Jest ni Vitest.

```bash
npm run test
npm run test:swagger-ui
```

Les tests sont principalement des **tests d'intégration** : ils démarrent l'application complète et frappent une vraie base PostgreSQL. `tests/setup-env.ts` charge `.env.test` puis `.env` ; à défaut, `DATABASE_URL` pointe sur `postgresql://postgres:postgres@localhost:5432/abregi_test`. La base est tronquée entre les suites (`--test-concurrency=1` pour éviter les conflits).

Les fichiers de test couvrent l'authentification, les espaces, les événements et leurs modules, les bénévoles et conventions, la comptabilité, le matériel, les imports, les notifications, l'administration et la couverture OpenAPI (`swagger.test.ts`).

---

## Base de données

Le modèle de données est défini dans `prisma/schema.prisma`, organisé en plusieurs couches :

- **Auth** : `User`, `Session`, `VerificationToken`, `Account`
- **Multi-tenant** : `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `LegalEntity`
- **Répertoire** : `Person`, `PersonDocument`, `PersonHistoryNote`, `Venue`, `Supplier`
- **Événements** : `Event`, `EventCollaborator`, `EventParticipant`
- **Bénévoles** : `VolunteerForm`, `VolunteerApplication`, `VolunteerContract`, `VolunteerContractAccess`, `VolunteerEmail`, `VolunteerSwap`, `Shift`, `CateringService`, `CateringBooking`
- **Tâches** : `Task`, `TaskComment`, `TaskCategory`, `TaskAttachment`, `TaskAssignee`, `TaskCalendarSubscription`
- **Conducteur** : `RunOfShowTrack`, `RunOfShowSection`, `RunOfShowItem`, `RunOfShowDependency`
- **Notifications & activité** : `EventNotificationSettings`, `NotificationDelivery`, `ActivityEntry`, `InAppNotification`, `ActivityNotificationPreference`
- **Budget & finance** : `Expense`, `ExpenseClaim`, `Income`, `TicketTier`, `ConsumableItem`, `EventCollective`, `EventCollectiveMember`, `Invoice`, `InvoiceLine`, `FiscalYear`, `ElectronicInvoicingConnection`, `ElectronicInvoicingOAuthState`
- **Courses** : `ShoppingItem`
- **Matériel** : `EquipmentItem`, `EquipmentGroup`, `EquipmentGroupItem`, `EquipmentUsage`, `EquipmentQuote`, `EquipmentImportMatchMemory`
- **Administration** : `ApiLog`
- **Divers** : `Document`, `Channel`, `Announcement`

### Schéma ERD

Un diagramme entité-relation est généré automatiquement depuis `schema.prisma` :

```bash
npm run db:erd          # génère docs/erd.svg
```

Le fichier `docs/erd.svg` est versionné — il est mis à jour à chaque modification du schéma. `DISABLE_ERD=true` désactive cette génération (CI, Docker).

### Conventions

- Ne **jamais modifier** une migration déjà commitée — toujours créer une nouvelle migration.
- Avant `npm run db:migrate` sur une base partagée, vérifier l'impact avec l'équipe.
- Le client Prisma est régénéré automatiquement après chaque migration (`db:generate`).

---

## Déploiement

`.github/workflows/deploy.yml` enchaîne :

1. **test** — PostgreSQL 17 éphémère, `npm ci`, `db:generate`, `db:deploy`, `typecheck`, `typecheck:tests`, `npm test`, `test:swagger-ui`
2. **build** — image Docker publiée sur GHCR (`staging` ou `latest`, SHA du commit, version du tag)
3. **deploy** — via SSH sur le VPS : mise à jour du `.env` et du `docker-compose.yml` (PostgreSQL, MailHog, backend, frontend), puis redémarrage

### Branches et environnements

| Déclencheur | Tests | Déploiement |
|-------------|-------|-------------|
| push sur `dev` | oui | **staging** — https://staging.abregi.com (`~/gwertable-staging`, images `:staging`) |
| pull request vers `main` | oui | aucun |
| push sur `main` (merge de PR) ou tag `v*` | oui | **production** — https://www.abregi.com (`~/gwertable`, images `:latest`) |

On développe sur `dev`, on valide sur le staging, puis on ouvre une PR `dev` → `main`. Un tag `vX.Y.Z` (optionnel) publie aussi l'image `:X.Y.Z`, ce qui permet de revenir à une version précise.

Staging et production tournent sur le même VPS dans deux projets Docker Compose isolés (base PostgreSQL, uploads et MailHog distincts). Le staging est protégé par une authentification basique nginx et utilise le cookie `abregi_staging_session` pour ne pas entrer en collision avec le cookie `.abregi.com` de production. Avant chaque migration en production, un dump PostgreSQL est écrit dans `~/backups/predeploy-*.sql.gz` (conservé 14 jours).

Le `docker-compose.yml` est réécrit par les workflows des deux dépôts : il doit rester identique dans `gwertable-backend` et `gwertable-frontend`.

Chaque commit poussé doit donc passer la suite complète, y compris la couverture OpenAPI. Au démarrage, le conteneur applique les migrations (`npm run db:deploy`) puis lance `node dist/server.js` sur le port 4000.
