# Abregi Backend

API REST pour la plateforme Abregi — gestion d'événements, participants, budget, matériel et conducteur de show.

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
cd abregi-backend

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

# Base de données
npm run db:generate        # régénère le client Prisma après un changement de schéma
npm run db:migrate         # applique les migrations en développement
npm run db:deploy          # applique les migrations en production (sans prompt)
npm run db:studio          # ouvre Prisma Studio (UI de la base)
```

---

## Authentification

L'API utilise un système de **lien magique par email** (magic link), sans mot de passe.

### Flux de connexion

```
1. POST /api/auth/login-link   { email }
   → génère un token, envoie un email avec un lien de connexion

2. POST /api/auth/verify       { email, token }
   → valide le token, crée une session
   → retourne { sessionToken, expires, user }

3. Toutes les requêtes authentifiées :
   Authorization: Bearer <sessionToken>
   (ou cookie abregi_session=<sessionToken>)

4. POST /api/auth/logout
   → invalide la session
```

### Invitations

Un `inviteToken` optionnel peut être fourni à `/login-link` et `/verify` pour rejoindre un espace de travail ou accepter une invitation à un événement.

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

**76 endpoints** sont documentés, regroupés en 15 domaines :
Système, Auth, Compte, Workspace, Membres, Personnes, Événements, Shotgun, Participants, Tâches, Conducteur, Budget, Courses, Matériel, Fichiers.

---

## Domaines fonctionnels

### Espaces de travail & membres
Gestion multi-tenant : création d'espaces, gestion des membres avec rôles (`ADMIN`, `ORGANIZER`, `TREASURER`, `VOLUNTEER`, `ARTIST`, `VIEWER`), invitations par email, transfert de contacts entre espaces.

### Personnes
Répertoire de contacts partagé dans l'espace de travail. Recherche par nom/email/téléphone/tags, archivage logique.

### Événements
CRUD d'événements avec gestion des lieux. Deux modes d'accès : membres de l'espace (accès complet) ou collaborateurs externes (accès limité à leurs événements).

### Participants
Ajout de personnes du répertoire à un événement avec rôles (`GUEST`, `VOLUNTEER`, `ARTIST`, `STAFF`, `SUPPLIER`), RSVP, informations de set (artistes), cachet avec synchronisation automatique de la dépense associée.

### Collaborateurs d'événement
Invitation d'utilisateurs externes sur un événement spécifique via un lien unique, sans compte dans l'espace de travail.

### Tâches & conducteur de show
Gestion des tâches par événement avec statuts et priorités. Synchronisation bidirectionnelle tâche ↔ élément du conducteur de show (si la tâche est planifiée le même jour que l'événement). Export calendrier ICS avec abonnement via token public.

### Budget
- **Dépenses** : avec rattachement de justificatifs, catégories libres, suivi des remboursements
- **Revenus** : catégories prédéfinies (bar, merch, caisse, sponsor, autre)
- **Tarifs billets** : manuels ou synchronisés depuis l'API Shotgun
- **Consommables** : articles avec prix unitaire et quantité estimée

### Courses
Liste de courses collaborative avec statut acheté/non acheté, création automatique d'une dépense lors de l'achat.

### Matériel
Catalogue d'équipements de l'espace de travail avec gestion des conflits de disponibilité (chevauchement d'événements). Usages one-off ou depuis le catalogue. Devis avec remise et attachement de fichiers. Synchronisation automatique des dépenses équipement.

### Intégration Shotgun
Synchronisation des tarifs billets depuis l'API Shotgun (billetterie) : récupération des deals, comptage des ventes.

### Uploads
- Justificatifs de dépenses (PDF, images, max 8 Mo)
- Bannières d'événements (images, max 5 Mo)
- Fichiers de devis équipement (PDF, images, Word, max 20 Mo)
- Images de profil utilisateur (images, max 2 Mo)

---

## Structure du projet

```
src/
├── app.ts                        # Bootstrap Fastify + enregistrement des plugins et routes
├── server.ts                     # Point d'entrée, listen + graceful shutdown
├── env.ts                        # Validation et typage des variables d'environnement
├── prisma.ts                     # Singleton PrismaClient
│
├── plugins/
│   ├── auth.ts                   # Middleware de session, décoration des requêtes
│   ├── errors.ts                 # Gestionnaire d'erreurs centralisé
│   └── swagger.ts                # Plugin OpenAPI 3.0 / Swagger UI
│
├── lib/
│   ├── errors.ts                 # Classes d'erreurs typées (AppError et sous-classes)
│   ├── calendar.ts               # Helpers génération ICS
│   ├── token.ts                  # Génération de tokens aléatoires
│   ├── permissions.ts            # Matrice de permissions par rôle
│   ├── money.ts                  # Conversion euros → centimes
│   ├── mailer.ts                 # Envoi d'emails (magic link)
│   └── shotgun.ts                # Client API Shotgun
│
├── dao/                          # Data Access Objects — une classe par modèle Prisma
│   └── *.dao.ts                  # (17 fichiers)
│
├── repositories/                 # Requêtes domaine-spécifiques, orchestration des DAOs
│   └── *.repository.ts           # (10 fichiers)
│
├── services/                     # Logique métier, contrôle des permissions
│   └── *.service.ts              # (10 fichiers)
│
├── dto/                          # Types de réponse publics (découplés de Prisma)
│   └── *.dto.ts                  # (8 fichiers)
│
├── schemas/                      # Schémas Zod de validation des entrées
│   └── *.ts                      # (12 fichiers)
│
├── openapi/
│   └── schemas.ts                # Documentation OpenAPI centralisée (76 endpoints)
│
└── routes/
    ├── health.ts
    ├── auth.ts
    ├── events.ts
    ├── people.ts
    ├── workspace.ts
    ├── equipment.ts
    ├── shotgun.ts
    └── event-modules/
        ├── participants.ts
        ├── tasks.ts
        ├── run-of-show.ts
        ├── budget.ts
        ├── shopping.ts
        ├── equipment-event.ts
        └── uploads.ts

prisma/
├── schema.prisma                 # Source de vérité du modèle de données (28 modèles)
└── migrations/                   # 16 migrations

tests/
├── helpers.ts                    # Utilitaires de test (setup, reset DB, seeders)
├── setup-env.ts                  # Configuration de l'environnement de test
├── auth.test.ts
├── event-modules.test.ts
├── people-events.test.ts
├── workspace.test.ts
└── shotgun.test.ts
```

---

## Tests

La suite de tests utilise le **runner natif Node.js** (`node:test`), sans Jest ni Vitest.

```bash
npm run test
```

Les tests sont des **tests d'intégration** : ils démarrent l'application complète et frappent une vraie base de données (variable `TEST_DATABASE_URL`). La base est tronquée entre chaque suite de tests (`--test-concurrency=1` pour éviter les conflits).

**20 tests** couvrent les domaines auth, événements, personnes, workspace et Shotgun.

---

## Base de données

Le modèle de données comprend **28 modèles Prisma**, organisés en plusieurs couches :

- **Auth** : `User`, `Session`, `VerificationToken`, `Account`
- **Multi-tenant** : `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`
- **Répertoire** : `Person`, `Venue`, `Supplier`
- **Événements** : `Event`, `EventCollaborator`, `EventParticipant`
- **Tâches** : `Task`, `Shift`, `RunOfShowItem`, `TaskCalendarSubscription`
- **Budget** : `Expense`, `Income`, `TicketTier`, `ConsumableItem`
- **Courses** : `ShoppingItem`
- **Matériel** : `EquipmentItem`, `EquipmentUsage`, `EquipmentQuote`
- **Divers** : `Document`, `Channel`, `Announcement`

### Conventions

- Ne **jamais modifier** une migration déjà commitée — toujours créer une nouvelle migration.
- Avant `npm run db:migrate` sur une base partagée, vérifier l'impact avec l'équipe.
- Le client Prisma est régénéré automatiquement après chaque migration (`db:generate`).
