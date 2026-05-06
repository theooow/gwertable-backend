# Abregi Backend

Backend REST séparé pour Abregi.

## Stack

Fastify · TypeScript · Prisma · PostgreSQL · Zod

## Démarrage

```bash
npm install
cp .env.example .env
npm run db:generate
npm run dev
```

L'API démarre par défaut sur `http://localhost:4000`.

## Auth

L'API utilise les tables Prisma `VerificationToken`, `Session` et `User`.
Le login crée un lien magique via `POST /api/auth/login-link`, puis `POST /api/auth/verify`
crée une session. Les routes applicatives attendent `Authorization: Bearer <sessionToken>`.

## Routes

- `GET /health`
- `GET /api/events`
- `POST /api/events`
- `GET /api/events/:id`
- `PUT /api/events/:id`
- `GET /api/events/venues`
- `POST /api/events/venues`
- `GET /api/people`
- `POST /api/people`
- `GET /api/people/tags`
- `GET /api/people/:id`
- `PUT /api/people/:id`
- `POST /api/people/:id/archive`
- `POST /api/people/:id/restore`
