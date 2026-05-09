import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "../env.js";
import { routeDocs } from "../openapi/schemas.js";

/**
 * Plugin Swagger — expose la documentation OpenAPI 3.0 sur `/docs`.
 *
 * Les schémas de routes sont injectés via le hook `transform` :
 * cela documente les endpoints sans déclencher la validation Fastify
 * (la validation reste assurée par Zod dans les handlers).
 */
export const swaggerPlugin = fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Abregi API",
        description:
          "API backend de la plateforme Abregi — gestion d'événements, participants, budget, équipements et conducteur de show.",
        version: "0.1.0",
        contact: {
          name: "Équipe Abregi",
        },
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: "Serveur de développement",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description:
              "Token de session obtenu via `POST /api/auth/verify`. À placer dans l'en-tête `Authorization: Bearer <token>`.",
          },
        },
      },
      tags: [
        { name: "Système", description: "Endpoints système et healthcheck" },
        { name: "Auth", description: "Authentification par lien magique et gestion de session" },
        { name: "Compte", description: "Profil utilisateur et changement d'espace de travail" },
        { name: "Workspace", description: "Paramètres et gestion de l'espace de travail" },
        { name: "Membres", description: "Membres et invitations de l'espace de travail" },
        { name: "Personnes", description: "Répertoire de contacts de l'espace de travail" },
        { name: "Événements", description: "CRUD événements et lieux" },
        { name: "Shotgun", description: "Intégration billetterie Shotgun" },
        { name: "Participants", description: "Participants et collaborateurs d'un événement" },
        { name: "Tâches", description: "Tâches d'un événement avec abonnement calendrier ICS" },
        { name: "Conducteur", description: "Conducteur de show (run-of-show)" },
        { name: "Budget", description: "Dépenses, revenus, tarifs billets, consommables" },
        { name: "Courses", description: "Liste de courses de l'événement" },
        { name: "Matériel", description: "Catalogue d'équipements et usages par événement" },
        { name: "Fichiers", description: "Upload et téléchargement de fichiers" },
      ],
    },

    transform({ schema, url, route }) {
      const raw = route.method;
      const m = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase() ?? "";
      const key = `${m} ${url}`;
      const doc = routeDocs[key];

      if (!doc) return { schema, url };

      const merged = {
        ...schema,
        ...(doc.tags && { tags: doc.tags }),
        ...(doc.summary && { summary: doc.summary }),
        ...(doc.description && { description: doc.description }),
        ...(doc.security !== undefined && { security: doc.security }),
        ...(doc.params && { params: doc.params }),
        ...(doc.querystring && { querystring: doc.querystring }),
        ...(doc.body && { body: doc.body }),
      };

      return { schema: merged, url };
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      syntaxHighlight: { activate: true, theme: "monokai" },
    },
    staticCSP: true,
  });
});
