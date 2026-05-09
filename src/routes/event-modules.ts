import type { FastifyInstance } from "fastify";

/**
 * Point d'entrée vide conservé pour compatibilité avec les imports existants.
 * Toutes les routes ont été migrées vers src/routes/event-modules/.
 *
 * @deprecated Remplacé par les sous-routes dans event-modules/
 */
export async function eventModuleRoutes(_fastify: FastifyInstance) {}
