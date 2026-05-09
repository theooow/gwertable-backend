import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { randomToken } from "../lib/token.js";

/**
 * DAO pour le modèle {@link TaskCalendarSubscription}.
 * Gère les abonnements de calendrier ICS pour les tâches d'événements.
 */
export class TaskCalendarSubscriptionDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne l'abonnement existant ou en crée un nouveau pour un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @returns L'abonnement avec son token
   */
  async upsert(eventId: string) {
    return this.prisma.taskCalendarSubscription.upsert({
      where: { eventId },
      create: { eventId, token: randomToken() },
      update: {},
    });
  }

  /**
   * Recherche un abonnement par son token public.
   *
   * @param token - Token de l'abonnement
   * @returns L'abonnement ou `null` s'il est absent
   */
  async findByToken(token: string) {
    return this.prisma.taskCalendarSubscription.findUnique({
      where: { token },
      select: { eventId: true, event: { select: { workspaceId: true } } },
    });
  }
}
