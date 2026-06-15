import type { PrismaClient } from "@prisma/client";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

const defaultInclude = {
  track: { select: { id: true, name: true, color: true, position: true } },
  section: { select: { id: true, name: true, color: true, position: true } },
  responsiblePerson: { select: { id: true, fullName: true } },
  sourceTask: { select: { id: true, title: true } },
  dependsOn: {
    select: {
      dependsOn: { select: { id: true, title: true, startsAt: true, status: true } },
    },
  },
  dependents: {
    select: {
      item: { select: { id: true, title: true, startsAt: true, status: true } },
    },
  },
} as const;

/**
 * DAO pour le modèle {@link RunOfShowItem}.
 * Fournit les opérations CRUD sur les éléments du conducteur d'un événement.
 */
export class RunOfShowDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Retourne les éléments du conducteur d'un événement, triés par heure et titre.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async findMany(eventId: string, workspaceId: string) {
    return this.prisma.runOfShowItem.findMany({
      where: { eventId, event: { workspaceId } },
      include: defaultInclude,
      orderBy: [{ startsAt: "asc" }, { title: "asc" }],
    });
  }

  /**
   * Recherche un élément par son identifiant avec validation de l'espace de travail.
   *
   * @param id - Identifiant de l'élément
   * @param workspaceId - Identifiant de l'espace de travail
   * @param eventId - Identifiant optionnel de l'événement pour validation supplémentaire
   * @returns L'élément ou `null` s'il est absent
   */
  async findByIdInWorkspace(id: string, workspaceId: string, eventId?: string) {
    return this.prisma.runOfShowItem.findFirst({
      where: { id, ...(eventId ? { eventId } : {}), event: { workspaceId } },
      select: { id: true, eventId: true, sourceTaskId: true },
    });
  }

  /**
   * Recherche un élément ou lève une erreur.
   *
   * @param id - Identifiant de l'élément
   * @param workspaceId - Identifiant de l'espace de travail
   * @param eventId - Identifiant optionnel de l'événement
   * @throws {NotFoundError} Si l'élément est introuvable
   */
  async findByIdOrThrow(id: string, workspaceId: string, eventId?: string) {
    const item = await this.findByIdInWorkspace(id, workspaceId, eventId);
    if (!item) throw new NotFoundError("Element de conducteur introuvable");
    return item;
  }

  /**
   * Crée un élément du conducteur.
   *
   * @param eventId - Identifiant de l'événement
   * @param data - Données validées
   */
  async create(
    eventId: string,
      data: {
      trackId: string | null;
      sectionId: string | null;
      status?: "PLANNED" | "IN_PROGRESS" | "DONE" | "DELAYED" | "CANCELLED";
      startsAt: Date;
      durationMin: number;
      title: string;
      responsible: string | null;
      responsiblePersonId: string | null;
      notes: string | null;
      stakeholderNote: string | null;
      delayReason: string | null;
      actualStartedAt: Date | null;
      completedAt: Date | null;
      sourceTaskId?: string;
    },
  ) {
    return this.prisma.runOfShowItem.create({
      data: { eventId, ...data },
      include: defaultInclude,
    });
  }

  /**
   * Met à jour un élément du conducteur.
   *
   * @param id - Identifiant de l'élément
   * @param data - Données de mise à jour
   */
  async update(
    id: string,
    data: {
      trackId: string | null;
      sectionId: string | null;
      status: "PLANNED" | "IN_PROGRESS" | "DONE" | "DELAYED" | "CANCELLED";
      startsAt: Date;
      durationMin: number;
      title: string;
      responsible: string | null;
      responsiblePersonId: string | null;
      notes: string | null;
      stakeholderNote: string | null;
      delayReason: string | null;
      actualStartedAt: Date | null;
      completedAt: Date | null;
    },
  ) {
    return this.prisma.runOfShowItem.update({
      where: { id },
      data,
      include: defaultInclude,
    });
  }

  /**
   * Supprime un élément du conducteur.
   *
   * @param id - Identifiant de l'élément
   */
  async delete(id: string) {
    return this.prisma.runOfShowItem.delete({ where: { id } });
  }
}
