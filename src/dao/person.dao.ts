import type { Prisma, PrismaClient } from "@prisma/client";
import type { PersonInput } from "../schemas/person.js";
import { BaseDao } from "./base.dao.js";
import { NotFoundError } from "../lib/errors.js";

export type PersonFilters = {
  search?: string;
  tags?: string[];
  contactType?: string;
  includeArchived?: boolean;
};

export class PersonDao extends BaseDao {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  async findMany(workspaceId: string, filters: PersonFilters = {}) {
    const { search, tags, contactType, includeArchived } = filters;

    const where: Prisma.PersonWhereInput = {
      workspaceId,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { tags: { hasSome: [search.toLowerCase()] } },
            ],
          }
        : {}),
      ...(tags && tags.length > 0 ? { tags: { hasSome: tags } } : {}),
      ...(contactType ? { contactType: contactType as Prisma.EnumPersonTypeFilter } : {}),
    };

    return this.prisma.person.findMany({ where, orderBy: { fullName: "asc" } });
  }

  async findById(id: string, workspaceId: string) {
    return this.prisma.person.findFirst({ where: { id, workspaceId } });
  }

  async findByIdOrThrow(id: string, workspaceId: string) {
    const person = await this.findById(id, workspaceId);
    if (!person) throw new NotFoundError("Personne introuvable");
    return person;
  }

  async findWithDetails(id: string, workspaceId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id, workspaceId },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        historyNotes: { orderBy: { createdAt: "desc" } },
        participations: {
          include: {
            event: {
              select: { id: true, name: true, startsAt: true, endsAt: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!person) throw new NotFoundError("Personne introuvable");
    return person;
  }

  async findTags(workspaceId: string): Promise<string[]> {
    const persons = await this.prisma.person.findMany({
      where: { workspaceId, archivedAt: null },
      select: { tags: true },
    });

    const tagSet = new Set<string>();
    for (const person of persons) {
      for (const tag of person.tags) tagSet.add(tag);
    }

    return [...tagSet].sort();
  }

  private buildPersonData(data: PersonInput) {
    return {
      fullName: data.fullName,
      email: data.email || null,
      phone: data.phone || null,
      discordUserId: data.discordUserId || null,
      tags: data.tags,
      notes: data.notes || null,
      contactType: data.contactType,
      availability: data.availability || null,
      negotiatedPrices: data.negotiatedPrices || null,
      specialConditions: data.specialConditions || null,
      technicalConstraints: data.technicalConstraints || null,
      averageFee: data.averageFee ?? null,
      bookingContact: data.bookingContact || null,
      musicalStyle: data.musicalStyle || null,
      riderNotes: data.riderNotes || null,
      venueCapacity: data.venueCapacity ?? null,
      soundConstraints: data.soundConstraints || null,
      openingHours: data.openingHours || null,
      electricalPower: data.electricalPower || null,
      securityContact: data.securityContact || null,
      sensibleNeighborhood: data.sensibleNeighborhood,
    };
  }

  async create(workspaceId: string, data: PersonInput) {
    return this.prisma.person.create({
      data: { workspaceId, ...this.buildPersonData(data) },
    });
  }

  async update(id: string, workspaceId: string, data: PersonInput) {
    return this.prisma.person.update({
      where: { id, workspaceId },
      data: this.buildPersonData(data),
    });
  }

  async setArchivedAt(id: string, workspaceId: string, date: Date | null) {
    return this.prisma.person.update({
      where: { id, workspaceId },
      data: { archivedAt: date },
    });
  }

  async createDocument(personId: string, data: { label: string; url: string; isUpload: boolean; category: string }) {
    return this.prisma.personDocument.create({ data: { personId, ...data } });
  }

  async deleteDocument(documentId: string, personId: string) {
    await this.prisma.personDocument.deleteMany({ where: { id: documentId, personId } });
  }

  async createHistoryNote(personId: string, data: { body: string; eventDate?: Date | null }) {
    return this.prisma.personHistoryNote.create({
      data: { personId, body: data.body, eventDate: data.eventDate ?? null },
    });
  }

  async deleteHistoryNote(noteId: string, personId: string) {
    await this.prisma.personHistoryNote.deleteMany({ where: { id: noteId, personId } });
  }
}
