import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import type { CollectiveInput, ProfitSplitInput } from "../schemas/collective.js";
import { ActivityRepository, type ActivityNotificationType } from "./activity.repository.js";

const collectiveInclude = {
  members: {
    select: {
      participantId: true,
      participant: { select: { personId: true, person: { select: { id: true, fullName: true } } } },
    },
  },
} satisfies Prisma.EventCollectiveInclude;

/**
 * Accès aux collectifs co-organisateurs d'un événement et à leur mode de partage du résultat.
 */
export class CollectiveRepository {
  private readonly activityRepository: ActivityRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.activityRepository = new ActivityRepository(prisma);
  }

  private async findEvent(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true, profitSplitMode: true, stakesFirst: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
    return event;
  }

  private async findCollective(id: string, workspaceId: string) {
    const existing = await this.prisma.eventCollective.findUnique({
      where: { id },
      select: { id: true, eventId: true, name: true, event: { select: { workspaceId: true } } },
    });
    if (!existing || existing.event.workspaceId !== workspaceId) throw new NotFoundError("Collectif introuvable");
    return existing;
  }

  private async assertParticipantsInEvent(eventId: string, participantIds: string[]) {
    const uniqueIds = [...new Set(participantIds)];
    if (uniqueIds.length === 0) return uniqueIds;
    const count = await this.prisma.eventParticipant.count({ where: { eventId, id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new ValidationError("Certains membres ne participent pas a l'evenement");
    return uniqueIds;
  }

  /** Remplace les membres d'un collectif ; un participant rejoint au plus un collectif par événement. */
  private async replaceMembers(tx: Prisma.TransactionClient, collectiveId: string, participantIds: string[]) {
    await tx.eventCollectiveMember.deleteMany({
      where: { OR: [{ collectiveId }, { participantId: { in: participantIds } }] },
    });
    await tx.eventCollectiveMember.createMany({
      data: participantIds.map((participantId) => ({ collectiveId, participantId })),
    });
  }

  private async record(workspaceId: string, eventId: string, userId: string, type: ActivityNotificationType, title: string, entityId: string) {
    await this.activityRepository.record({
      workspaceId, eventId, actorId: userId, type, title, entityType: "COLLECTIVE", entityId, notify: false,
    });
  }

  async list(eventId: string, workspaceId: string) {
    const event = await this.findEvent(eventId, workspaceId);
    const collectives = await this.prisma.eventCollective.findMany({
      where: { eventId },
      include: collectiveInclude,
      orderBy: { createdAt: "asc" },
    });
    return { profitSplitMode: event.profitSplitMode, stakesFirst: event.stakesFirst, collectives };
  }

  async updateProfitSplit(eventId: string, workspaceId: string, userId: string, data: ProfitSplitInput) {
    await this.findEvent(eventId, workspaceId);
    await this.prisma.event.update({ where: { id: eventId }, data: { profitSplitMode: data.profitSplitMode, stakesFirst: data.stakesFirst } });
    await this.record(workspaceId, eventId, userId, "COLLECTIVE_UPDATED", "Partage du résultat modifié", eventId);
    return this.list(eventId, workspaceId);
  }

  async create(eventId: string, workspaceId: string, userId: string, data: CollectiveInput) {
    await this.findEvent(eventId, workspaceId);
    const participantIds = await this.assertParticipantsInEvent(eventId, data.participantIds);
    const collective = await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventCollective.create({
        data: { eventId, name: data.name, shareBasisPoints: data.shareBasisPoints },
      });
      await this.replaceMembers(tx, created.id, participantIds);
      return tx.eventCollective.findUniqueOrThrow({ where: { id: created.id }, include: collectiveInclude });
    });
    await this.record(workspaceId, eventId, userId, "COLLECTIVE_CREATED", `Collectif créé : ${collective.name}`, collective.id);
    return collective;
  }

  async update(id: string, workspaceId: string, userId: string, data: CollectiveInput) {
    const existing = await this.findCollective(id, workspaceId);
    const participantIds = await this.assertParticipantsInEvent(existing.eventId, data.participantIds);
    const collective = await this.prisma.$transaction(async (tx) => {
      await tx.eventCollective.update({
        where: { id },
        data: { name: data.name, shareBasisPoints: data.shareBasisPoints },
      });
      await this.replaceMembers(tx, id, participantIds);
      return tx.eventCollective.findUniqueOrThrow({ where: { id }, include: collectiveInclude });
    });
    await this.record(workspaceId, existing.eventId, userId, "COLLECTIVE_UPDATED", `Collectif modifié : ${collective.name}`, id);
    return collective;
  }

  async delete(id: string, workspaceId: string, userId: string) {
    const existing = await this.findCollective(id, workspaceId);
    const collective = await this.prisma.eventCollective.delete({ where: { id } });
    await this.record(workspaceId, existing.eventId, userId, "COLLECTIVE_DELETED", `Collectif supprimé : ${existing.name}`, id);
    return collective;
  }
}
