import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { routeDocs } from "../openapi/schemas.js";
import { additionalDocs } from "../openapi/additional.js";
import { inputSchema } from "../openapi/contracts.js";
import { isPublicRoute } from "./auth.js";

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
          "API Abregi. Connectez-vous via Auth (mot de passe ou code email) pour utiliser la session du navigateur, ou renseignez un token dans Authorize. Les identifiants se récupèrent avec les routes de liste. Les montants suffixés Cents sont en centimes ; les autres montants suivent leur schéma. Les actions d'envoi, de suppression et de facturation sont réelles.",
        version: "0.1.0",
        contact: {
          name: "Équipe Abregi",
        },
      },
      servers: [
        {
          url: "/",
          description: "Serveur courant",
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
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "abregi_session",
            description: "Session créée par les routes de connexion. Le navigateur transmet automatiquement le cookie ; aucun collage manuel nécessaire.",
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
        { name: "Bénévoles", description: "Candidatures, planning, badges et restauration" },
        { name: "Finance", description: "Factures et notes de frais" },
        { name: "Facturation électronique", description: "Identité légale et connexion Super PDP" },
        { name: "Activité", description: "Fil d'activité et préférences" },
        { name: "Notifications", description: "Notifications des événements" },
        { name: "Administration", description: "Accès réservé aux administrateurs de la plateforme" },
      ],
    },

    transform({ schema, url, route }) {
      const raw = route.method;
      const m = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase() ?? "";
      const key = `${m} ${url}`;
      const doc = additionalDocs[key] ?? routeDocs[key];
      const contract = route.config?.documentation;
      if (!doc || !contract) return { schema, url };
      const isPublic = isPublicRoute(url);
      const params = Object.fromEntries([...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => [match[1], { type: "string", description: `Identifiant ${match[1]}` }]));
      const declaredParams = contract.params ? inputSchema(contract.params) : undefined;
      const isCalendar = url.startsWith("/calendar/") || url.endsWith("/calendar.ics");
      const isFile = url.startsWith("/uploads/") || url.endsWith("/pdf") || isCalendar;
      const contentType = url.endsWith("/pdf") ? "application/pdf" : isCalendar ? "text/calendar" : "application/octet-stream";
      const error = (description: string) => ({ description, type: "object", properties: { error: { type: "string" }, message: { type: "string" }, issues: { type: "array", items: { type: "object", additionalProperties: true } } } });
      const response = Object.fromEntries((contract.statusCodes ?? [200]).map((status) => [status, status >= 400 ? error("Requête refusée") : status === 204 ? { description: "Opération effectuée, sans contenu" } : isFile ? { description: "Fichier à télécharger", content: { [contentType]: { schema: { type: "string", format: "binary" } } } } : { description: status === 201 ? "Ressource créée" : "Opération effectuée" }]));
      return { schema: {
        ...schema,
        ...doc,
        operationId: `${m.toLowerCase()}_${url.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        security: isPublic ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
        ...(Object.keys(params).length ? { params: { type: "object", properties: Object.fromEntries(Object.entries(params).map(([name, value]) => [name, declaredParams?.properties?.[name] ?? value])), required: Object.keys(params) } } : {}),
        ...(contract.body ? { body: inputSchema(contract.body) } : {}),
        ...(contract.querystring ? { querystring: inputSchema(contract.querystring) } : {}),
        response: { ...response, 400: error("Paramètres ou corps invalides"), ...(!isPublic ? { 401: error("Session absente ou expirée"), 403: error("Droits insuffisants") } : {}), 404: error("Ressource introuvable"), 500: error("Erreur interne") },
      }, url };
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      withCredentials: true,
      tryItOutEnabled: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha",
      validatorUrl: null,
      syntaxHighlight: { activate: true, theme: "monokai" },
    },
    staticCSP: true,
  });
});
