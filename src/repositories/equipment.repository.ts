import type { AmountInputMode, PrismaClient } from "@prisma/client";
import type { EquipmentBulkImportInput, EquipmentItemInput, EquipmentUsageUpdateInput } from "../schemas/equipment.js";
import { NotFoundError, ConflictError } from "../lib/errors.js";
import { EquipmentItemDao } from "../dao/equipment-item.dao.js";
import { BudgetRepository } from "./budget.repository.js";
import type { EquipmentImportPreview } from "../services/document-extraction.service.js";

const itemSelect = {
  id: true, name: true, category: true, ownership: true,
  quantity: true, unitPriceCents: true, amountInputMode: true, vatRateBasisPoints: true, rentalCoef: true,
  supplierId: true, color: true, photoUrl: true,
  supplier: { select: { id: true, fullName: true } },
} as const;

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchScore(query: string, candidate: string) {
  const normalizedQuery = normalizeMatchText(query);
  const normalizedCandidate = normalizeMatchText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;
  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) return 0.9;

  const queryTokens = new Set(normalizedQuery.split(" ").filter((token) => token.length > 1));
  const candidateTokens = new Set(normalizedCandidate.split(" ").filter((token) => token.length > 1));
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;
  const common = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  return common / Math.max(queryTokens.size, candidateTokens.size);
}

/**
 * Repository pour le domaine équipement.
 * Couvre le catalogue (espace de travail) et les usages événement (usages + devis).
 */
export class EquipmentRepository {
  constructor(
    private readonly equipmentItemDao: EquipmentItemDao,
    private readonly budgetRepository: BudgetRepository,
    private readonly prisma: PrismaClient,
  ) {}

  // ── Catalogue ────────────────────────────────────────────────────────────────

  /**
   * Retourne tous les équipements actifs d'un espace de travail.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listForWorkspace(workspaceId: string) {
    return this.equipmentItemDao.findAllActive(workspaceId);
  }

  async enrichDocumentImportPreview(workspaceId: string, preview: EquipmentImportPreview): Promise<EquipmentImportPreview> {
    const lineSourceKeys = preview.lines.map((line) => normalizeMatchText(line.name)).filter(Boolean);
    const supplierSourceKey = preview.supplierName ? normalizeMatchText(preview.supplierName) : "";
    const [items, suppliers, memories] = await Promise.all([
      this.prisma.equipmentItem.findMany({
        where: { workspaceId, archivedAt: null },
        select: { id: true, name: true, category: true, supplier: { select: { fullName: true } } },
      }),
      this.prisma.person.findMany({
        where: { workspaceId, archivedAt: null, contactType: "SUPPLIER" },
        select: { id: true, fullName: true },
      }),
      this.prisma.equipmentImportMatchMemory.findMany({
        where: {
          workspaceId,
          OR: [
            ...(lineSourceKeys.length > 0 ? [{ kind: "equipment", sourceKey: { in: lineSourceKeys } }] : []),
            ...(supplierSourceKey ? [{ kind: "supplier", sourceKey: supplierSourceKey }] : []),
          ],
        },
        select: { kind: true, sourceKey: true, itemId: true, supplierId: true },
      }),
    ]);

    const rememberedSupplierId = memories.find((memory) => memory.kind === "supplier" && memory.sourceKey === supplierSourceKey)?.supplierId;
    const equipmentMemoryBySourceKey = new Map(
      memories
        .filter((memory) => memory.kind === "equipment" && memory.itemId)
        .map((memory) => [memory.sourceKey, memory.itemId!]),
    );

    const supplierCandidates = suppliers
      .map((supplier) => ({
        id: supplier.id,
        fullName: supplier.fullName,
        score: rememberedSupplierId === supplier.id ? 1 : matchScore(preview.supplierName ?? "", supplier.fullName),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    return {
      ...preview,
      supplierCandidates,
      lines: preview.lines.map((line) => ({
        ...line,
        equipmentCandidates: items
          .map((item) => {
            const rememberedItemId = equipmentMemoryBySourceKey.get(normalizeMatchText(line.name));
            const nameScore = matchScore(line.name, item.name);
            const categoryBoost = normalizeMatchText(line.category) === normalizeMatchText(item.category) ? 0.05 : 0;
            const supplierBoost = preview.supplierName && item.supplier?.fullName
              ? Math.min(matchScore(preview.supplierName, item.supplier.fullName), 1) * 0.1
              : 0;
            return {
              id: item.id,
              name: item.name,
              score: rememberedItemId === item.id ? 1 : Math.min(0.99, nameScore + categoryBoost + supplierBoost),
            };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 200),
      })),
    };
  }

  /**
   * Retourne un équipement ou lève une {@link NotFoundError}.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'équipement n'existe pas dans cet espace de travail
   */
  async findOrThrow(id: string, workspaceId: string) {
    const item = await this.equipmentItemDao.findByIdInWorkspace(id, workspaceId);
    if (!item) throw new NotFoundError("Équipement introuvable");
    return item;
  }

  /**
   * Crée un équipement dans le catalogue.
   *
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async create(workspaceId: string, data: EquipmentItemInput) {
    return this.equipmentItemDao.create(workspaceId, data);
  }

  /**
   * Met à jour un équipement après vérification de son existence.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si l'équipement n'existe pas dans cet espace de travail
   */
  async update(id: string, workspaceId: string, data: EquipmentItemInput) {
    await this.findOrThrow(id, workspaceId);
    return this.equipmentItemDao.update(id, data);
  }

  /**
   * Archive un équipement après vérification de son existence.
   *
   * @param id - Identifiant de l'équipement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'équipement n'existe pas dans cet espace de travail
   */
  async archive(id: string, workspaceId: string) {
    await this.findOrThrow(id, workspaceId);
    return this.equipmentItemDao.archive(id);
  }

  /**
   * Importe des items d'un autre workspace dans le workspace courant.
   * Copie uniquement les champs catalogue (pas les usages événement).
   */
  async importFromWorkspace(targetWorkspaceId: string, sourceWorkspaceId: string, itemIds: string[]) {
    const sourceItems = await this.prisma.equipmentItem.findMany({
      where: { workspaceId: sourceWorkspaceId, id: { in: itemIds }, archivedAt: null },
    });

    const created = await this.prisma.$transaction(
      sourceItems.map((item) =>
        this.prisma.equipmentItem.create({
          data: {
            workspaceId: targetWorkspaceId,
            name: item.name,
            category: item.category,
            ownership: item.ownership,
            unitPriceCents: item.unitPriceCents,
            amountInputMode: item.amountInputMode,
            vatRateBasisPoints: item.vatRateBasisPoints,
            rentalCoef: item.rentalCoef,
            quantity: item.quantity,
            notes: item.notes,
            photoUrl: item.photoUrl,
            color: item.color,
          },
          include: { owner: { select: { id: true, fullName: true } }, supplier: { select: { id: true, fullName: true } } },
        }),
      ),
    );
    return created;
  }

  // ── Usages événement ─────────────────────────────────────────────────────────

  /**
   * Retourne les usages d'équipement d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listUsages(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.equipmentUsage.findMany({
      where: { eventId },
      include: { item: { select: itemSelect } },
      orderBy: { id: "asc" },
    });
  }

  /**
   * Crée un usage d'équipement sur un événement (catalogue ou one-off).
   * Pour les articles du catalogue, vérifie les conflits de disponibilité.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param parsed - Données validées (discriminated union library | oneoff)
   */
  async createUsage(
    eventId: string,
    workspaceId: string,
    parsed: { kind: "library"; itemId: string; quantity: number; unitPriceCents?: number; amountInputMode?: AmountInputMode; vatRateBasisPoints?: number; rentalCoef?: number; notes?: string | null; quoteId?: string | null }
           | { kind: "oneoff"; name: string; category: string; quantity: number; unitPriceCents: number; amountInputMode: AmountInputMode; vatRateBasisPoints: number; rentalCoef: number; notes?: string | null; quoteId?: string | null },
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    if (parsed.kind === "library") {
      const libItem = await this.prisma.equipmentItem.findUnique({
        where: { id: parsed.itemId, workspaceId },
        select: { id: true, quantity: true, unitPriceCents: true, amountInputMode: true, vatRateBasisPoints: true, rentalCoef: true },
      });
      if (!libItem) throw new NotFoundError("Équipement introuvable");

      await this.assertNoQuantityConflict(
        parsed.itemId, eventId, event.startsAt, event.endsAt, libItem.quantity, parsed.quantity,
      );

      const existing = await this.prisma.equipmentUsage.findUnique({
        where: { eventId_itemId: { eventId, itemId: parsed.itemId } },
        select: { id: true },
      });
      if (existing) throw new ConflictError("Cet équipement est déjà ajouté à cet événement");

      const usage = await this.prisma.equipmentUsage.create({
        data: {
          eventId,
          itemId: parsed.itemId,
          quantity: parsed.quantity,
          unitPriceCents: parsed.unitPriceCents ?? libItem.unitPriceCents,
          amountInputMode: parsed.amountInputMode ?? libItem.amountInputMode,
          vatRateBasisPoints: parsed.vatRateBasisPoints ?? libItem.vatRateBasisPoints,
          rentalCoef: parsed.rentalCoef ?? libItem.rentalCoef,
          notes: parsed.notes || null,
          quoteId: parsed.quoteId || null,
        },
        include: { item: { select: itemSelect } },
      });
      await this.budgetRepository.syncEquipmentExpenses(eventId);
      return usage;
    }

    const usage = await this.prisma.equipmentUsage.create({
      data: {
        eventId,
        itemId: null,
        name: parsed.name,
        category: parsed.category,
        quantity: parsed.quantity,
        unitPriceCents: parsed.unitPriceCents,
        amountInputMode: parsed.amountInputMode,
        vatRateBasisPoints: parsed.vatRateBasisPoints,
        rentalCoef: parsed.rentalCoef,
        notes: parsed.notes || null,
        quoteId: parsed.quoteId || null,
      },
    });
    await this.budgetRepository.syncEquipmentExpenses(eventId);
    return usage;
  }

  async bulkImportLibraryUsages(eventId: string, workspaceId: string, data: EquipmentBulkImportInput) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    const itemIds = data.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new ConflictError("Un equipement ne peut etre importe qu'une seule fois a la fois");
    }

    const items = await this.prisma.equipmentItem.findMany({
      where: { id: { in: itemIds }, workspaceId, archivedAt: null },
      select: {
        id: true,
        quantity: true,
        unitPriceCents: true,
        amountInputMode: true,
        vatRateBasisPoints: true,
        rentalCoef: true,
        supplierId: true,
        supplier: { select: { id: true, fullName: true } },
      },
    });
    if (items.length !== itemIds.length) throw new NotFoundError("Equipement introuvable");

    const existingUsages = await this.prisma.equipmentUsage.findMany({
      where: { eventId, itemId: { in: itemIds } },
      select: { itemId: true },
    });
    if (existingUsages.length > 0) {
      throw new ConflictError("Un ou plusieurs equipements sont deja ajoutes a cet evenement");
    }

    const explicitQuoteIds = [...new Set(data.lines.map((line) => line.quoteId).filter(Boolean) as string[])];
    if (explicitQuoteIds.length > 0) {
      const quoteCount = await this.prisma.equipmentQuote.count({
        where: { eventId, id: { in: explicitQuoteIds } },
      });
      if (quoteCount !== explicitQuoteIds.length) throw new NotFoundError("Devis introuvable");
    }

    const itemById = new Map(items.map((item) => [item.id, item]));
    await Promise.all(data.lines.map((line) => {
      const item = itemById.get(line.itemId);
      if (!item) throw new NotFoundError("Equipement introuvable");
      return this.assertNoQuantityConflict(
        line.itemId,
        eventId,
        event.startsAt,
        event.endsAt,
        item.quantity,
        line.quantity,
      );
    }));

    const result = await this.prisma.$transaction(async (tx) => {
      const createdQuotes: Array<{ id: string; eventId: string; label: string; discountCents: number | null; discountPct: unknown; fileUrl: string | null }> = [];
      const quoteBySupplierId = new Map<string, string>();

      if (data.createQuotesBySupplier) {
        const suppliers = new Map<string, string>();
        for (const line of data.lines) {
          if (line.quoteId) continue;
          const item = itemById.get(line.itemId);
          if (item?.supplierId && item.supplier?.fullName) {
            suppliers.set(item.supplierId, item.supplier.fullName);
          }
        }

        for (const [supplierId, supplierName] of suppliers.entries()) {
          const quote = await tx.equipmentQuote.create({
            data: { eventId, label: `Devis ${supplierName}` },
          });
          createdQuotes.push(quote);
          quoteBySupplierId.set(supplierId, quote.id);
        }
      }

      const usages = await Promise.all(data.lines.map((line) => {
        const item = itemById.get(line.itemId)!;
        const generatedQuoteId = item.supplierId ? quoteBySupplierId.get(item.supplierId) : undefined;
        return tx.equipmentUsage.create({
          data: {
            eventId,
            itemId: line.itemId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents ?? item.unitPriceCents,
            amountInputMode: line.amountInputMode ?? item.amountInputMode,
            vatRateBasisPoints: line.vatRateBasisPoints ?? item.vatRateBasisPoints,
            rentalCoef: line.rentalCoef ?? item.rentalCoef,
            notes: line.notes || null,
            quoteId: line.quoteId || generatedQuoteId || null,
          },
          include: {
            item: { select: itemSelect },
            quote: { select: { id: true, label: true } },
          },
        });
      }));

      return { usages, quotes: createdQuotes };
    });

    await this.budgetRepository.syncEquipmentExpenses(eventId);
    return result;
  }

  /**
   * Met à jour un usage d'équipement.
   *
   * @param usageId - Identifiant de l'usage
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées de mise à jour
   * @throws {NotFoundError} Si l'usage est introuvable
   * @throws {ConflictError} Si la quantité dépasse la disponibilité
   */
  async updateUsage(
    usageId: string,
    eventId: string,
    workspaceId: string,
    data: EquipmentUsageUpdateInput,
  ) {
    await this.assertEventInWorkspace(eventId, workspaceId);

    const usage = await this.prisma.equipmentUsage.findUnique({
      where: { id: usageId, eventId },
      select: { id: true, itemId: true, item: { select: { quantity: true } } },
    });
    if (!usage) throw new NotFoundError("Utilisation introuvable");

    if (usage.itemId && data.quantity !== undefined) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { startsAt: true, endsAt: true },
      });
      if (event) {
        await this.assertNoQuantityConflict(
          usage.itemId, eventId, event.startsAt, event.endsAt,
          usage.item?.quantity ?? 1, data.quantity,
        );
      }
    }

    if (data.quoteId) {
      const quote = await this.prisma.equipmentQuote.findUnique({
        where: { id: data.quoteId },
        select: { eventId: true },
      });
      if (!quote || quote.eventId !== eventId) throw new NotFoundError("Devis introuvable");
    }

    const updated = await this.prisma.equipmentUsage.update({
      where: { id: usageId },
      data: {
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        unitPriceCents: data.unitPriceCents,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: data.vatRateBasisPoints,
        rentalCoef: data.rentalCoef,
        quoteId: data.quoteId,
        conditionBefore: data.conditionBefore,
        conditionAfter: data.conditionAfter,
        returned: data.returned,
        notes: data.notes,
      },
      include: {
        item: { select: itemSelect },
        quote: { select: { id: true, label: true } },
      },
    });
    await this.budgetRepository.syncEquipmentExpenses(eventId);
    return updated;
  }

  /**
   * Supprime un usage d'équipement.
   *
   * @param usageId - Identifiant de l'usage
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si l'usage est introuvable
   */
  async deleteUsage(usageId: string, eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const usage = await this.prisma.equipmentUsage.findUnique({
      where: { id: usageId, eventId },
      select: { id: true },
    });
    if (!usage) throw new NotFoundError("Utilisation introuvable");

    await this.prisma.equipmentUsage.delete({ where: { id: usageId } });
    await this.budgetRepository.syncEquipmentExpenses(eventId);
  }

  // ── Devis équipement ─────────────────────────────────────────────────────────

  /**
   * Retourne les devis d'équipement d'un événement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   */
  async listQuotes(eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.equipmentQuote.findMany({
      where: { eventId },
      include: {
        usages: { include: { item: { select: itemSelect } } },
      },
      orderBy: { label: "asc" },
    });
  }

  /**
   * Crée un devis d'équipement.
   *
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   */
  async createQuote(
    eventId: string,
    workspaceId: string,
    data: { label: string; amountInputMode: AmountInputMode; vatRateBasisPoints: number; discountCents?: number | null; discountPct?: number | null },
  ) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    return this.prisma.equipmentQuote.create({
      data: {
        eventId,
        label: data.label,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: data.vatRateBasisPoints,
        discountCents: data.discountCents ?? null,
        discountPct: data.discountPct ?? null,
      },
      include: { usages: true },
    });
  }

  async createQuoteWithOneOffUsages(
    eventId: string,
    workspaceId: string,
    data: {
      label: string;
      amountInputMode: AmountInputMode;
      vatRateBasisPoints: number;
      discountCents?: number | null;
      discountPct?: number | null;
      fileUrl?: string | null;
      supplierName?: string | null;
      supplierId?: string | null;
      createSupplierName?: string | null;
      lines: Array<{
        name: string;
        category: string;
        quantity: number;
        unitPriceCents: number;
        amountInputMode?: AmountInputMode;
        vatRateBasisPoints?: number;
        rentalCoef: number;
        matchedItemId?: string | null;
        createCatalogItem?: boolean;
        supplierId?: string | null;
        createSupplierName?: string | null;
        notes?: string | null;
      }>;
    },
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");

    const matchedItemIds = data.lines.map((line) => line.matchedItemId).filter(Boolean) as string[];
    if (matchedItemIds.length > 0) {
      const matchedItems = await this.prisma.equipmentItem.findMany({
        where: { id: { in: matchedItemIds }, workspaceId, archivedAt: null },
        select: { id: true, quantity: true },
      });
      if (matchedItems.length !== new Set(matchedItemIds).size) throw new NotFoundError("Equipement introuvable");

      const existingUsages = await this.prisma.equipmentUsage.findMany({
        where: { eventId, itemId: { in: matchedItemIds } },
        select: { itemId: true },
      });
      if (existingUsages.length > 0) throw new ConflictError("Un ou plusieurs equipements sont deja ajoutes a cet evenement");

      const matchedItemById = new Map(matchedItems.map((item) => [item.id, item]));
      await Promise.all(data.lines.map((line) => {
        if (!line.matchedItemId) return Promise.resolve();
        const item = matchedItemById.get(line.matchedItemId);
        if (!item) throw new NotFoundError("Equipement introuvable");
        return this.assertNoQuantityConflict(
          line.matchedItemId,
          eventId,
          event.startsAt,
          event.endsAt,
          item.quantity,
          line.quantity,
        );
      }));
    }

    const quote = await this.prisma.$transaction(async (tx) => {
      const supplierByName = new Map<string, string>();
      let documentSupplierId = data.supplierId ?? null;

      async function getOrCreateSupplier(name?: string | null) {
        const cleanName = name?.trim();
        if (!cleanName) return null;
        const key = normalizeMatchText(cleanName);
        const existingId = supplierByName.get(key);
        if (existingId) return existingId;
        const person = await tx.person.create({
          data: {
            workspaceId,
            fullName: cleanName,
            tags: [],
            contactType: "SUPPLIER",
          },
          select: { id: true },
        });
        supplierByName.set(key, person.id);
        return person.id;
      }

      documentSupplierId = documentSupplierId ?? (await getOrCreateSupplier(data.createSupplierName));
      const supplierMemoryName = data.supplierName || data.createSupplierName;
      if (documentSupplierId && supplierMemoryName?.trim()) {
        await tx.equipmentImportMatchMemory.upsert({
          where: {
            workspaceId_kind_sourceKey: {
              workspaceId,
              kind: "supplier",
              sourceKey: normalizeMatchText(supplierMemoryName),
            },
          },
          create: {
            workspaceId,
            kind: "supplier",
            sourceName: supplierMemoryName.trim(),
            sourceKey: normalizeMatchText(supplierMemoryName),
            supplierId: documentSupplierId,
          },
          update: {
            sourceName: supplierMemoryName.trim(),
            supplierId: documentSupplierId,
            itemId: null,
          },
        });
      }

      const createdQuote = await tx.equipmentQuote.create({
        data: {
          eventId,
          label: data.label,
          amountInputMode: data.amountInputMode,
          vatRateBasisPoints: data.vatRateBasisPoints,
          discountCents: data.discountCents ?? null,
          discountPct: data.discountPct ?? null,
          fileUrl: data.fileUrl ?? null,
        },
      });

      for (const line of data.lines) {
        const supplierId = line.supplierId ?? documentSupplierId ?? (await getOrCreateSupplier(line.createSupplierName));
        const itemId = line.matchedItemId ?? (line.createCatalogItem
          ? (await tx.equipmentItem.create({
              data: {
                workspaceId,
                name: line.name,
                category: line.category,
                ownership: "RENTED",
                supplierId,
                unitPriceCents: line.unitPriceCents,
                amountInputMode: line.amountInputMode ?? data.amountInputMode,
                vatRateBasisPoints: line.vatRateBasisPoints ?? data.vatRateBasisPoints,
                rentalCoef: line.rentalCoef,
                quantity: Math.max(1, line.quantity),
                notes: line.notes || null,
              },
              select: { id: true },
            })).id
          : null);

        if (itemId && line.name.trim()) {
          await tx.equipmentImportMatchMemory.upsert({
            where: {
              workspaceId_kind_sourceKey: {
                workspaceId,
                kind: "equipment",
                sourceKey: normalizeMatchText(line.name),
              },
            },
            create: {
              workspaceId,
              kind: "equipment",
              sourceName: line.name.trim(),
              sourceKey: normalizeMatchText(line.name),
              itemId,
            },
            update: {
              sourceName: line.name.trim(),
              itemId,
              supplierId: null,
            },
          });
        }

        await tx.equipmentUsage.create({
          data: {
            eventId,
            itemId,
            name: itemId ? null : line.name,
            category: itemId ? null : line.category,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            amountInputMode: line.amountInputMode ?? data.amountInputMode,
            vatRateBasisPoints: line.vatRateBasisPoints ?? data.vatRateBasisPoints,
            rentalCoef: line.rentalCoef,
            notes: line.notes || null,
            quoteId: createdQuote.id,
          },
        });
      }

      return tx.equipmentQuote.findUniqueOrThrow({
        where: { id: createdQuote.id },
        include: {
          usages: { include: { item: { select: itemSelect } } },
        },
      });
    });

    await this.budgetRepository.syncEquipmentExpenses(eventId);
    return quote;
  }

  /**
   * Met à jour un devis et resynchronise les dépenses équipement.
   *
   * @param quoteId - Identifiant du devis
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param data - Données validées
   * @throws {NotFoundError} Si le devis est introuvable
   */
  async updateQuote(
    quoteId: string,
    eventId: string,
    workspaceId: string,
    data: { label: string; amountInputMode: AmountInputMode; vatRateBasisPoints: number; discountCents?: number | null; discountPct?: number | null },
  ) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.equipmentQuote.findUnique({
      where: { id: quoteId, eventId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Devis introuvable");

    const updated = await this.prisma.equipmentQuote.update({
      where: { id: quoteId },
      data: {
        label: data.label,
        amountInputMode: data.amountInputMode,
        vatRateBasisPoints: data.vatRateBasisPoints,
        discountCents: data.discountCents ?? null,
        discountPct: data.discountPct ?? null,
      },
      include: {
        usages: { include: { item: { select: itemSelect } } },
      },
    });
    await this.budgetRepository.syncEquipmentExpenses(eventId);
    return updated;
  }

  /**
   * Supprime un devis et resynchronise les dépenses équipement.
   * Les usages liés voient leur `quoteId` mis à `null` via `onDelete: SetNull`.
   *
   * @param quoteId - Identifiant du devis
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @throws {NotFoundError} Si le devis est introuvable
   */
  async deleteQuote(quoteId: string, eventId: string, workspaceId: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.equipmentQuote.findUnique({
      where: { id: quoteId, eventId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Devis introuvable");

    await this.prisma.equipmentQuote.delete({ where: { id: quoteId } });
    await this.budgetRepository.syncEquipmentExpenses(eventId);
  }

  /**
   * Attache un fichier à un devis et resynchronise les dépenses équipement.
   *
   * @param quoteId - Identifiant du devis
   * @param eventId - Identifiant de l'événement
   * @param workspaceId - Identifiant de l'espace de travail
   * @param fileUrl - URL du fichier uploadé
   * @throws {NotFoundError} Si le devis est introuvable
   */
  async attachQuoteFile(quoteId: string, eventId: string, workspaceId: string, fileUrl: string) {
    await this.assertEventInWorkspace(eventId, workspaceId);
    const existing = await this.prisma.equipmentQuote.findUnique({
      where: { id: quoteId, eventId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Devis introuvable");

    await this.prisma.equipmentQuote.update({ where: { id: quoteId }, data: { fileUrl } });
    await this.budgetRepository.syncEquipmentExpenses(eventId);
  }

  // ── Helpers privés ───────────────────────────────────────────────────────────

  private async assertEventInWorkspace(eventId: string, workspaceId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId },
      select: { id: true },
    });
    if (!event) throw new NotFoundError("Evenement introuvable");
  }

  /**
   * Vérifie qu'il n'y a pas de conflit de quantité pour un article du catalogue.
   * Lève une {@link ConflictError} si la quantité demandée dépasse la disponibilité.
   */
  private async assertNoQuantityConflict(
    itemId: string,
    eventId: string,
    startsAt: Date,
    endsAt: Date | null,
    totalQuantity: number,
    requestedQuantity: number,
  ) {
    const overlapping = await this.prisma.equipmentUsage.findMany({
      where: {
        itemId,
        eventId: { not: eventId },
        event: {
          AND: [
            { startsAt: { lte: endsAt ?? new Date("2099-01-01") } },
            { OR: [{ endsAt: null }, { endsAt: { gte: startsAt } }] },
          ],
        },
      },
      select: { quantity: true, event: { select: { name: true } } },
    });

    const alreadyBooked = overlapping.reduce((s, u) => s + u.quantity, 0);
    const available = totalQuantity - alreadyBooked;

    if (requestedQuantity > available) {
      const conflictNames = [...new Set(overlapping.map((u) => u.event.name))].join(", ");
      throw new ConflictError(
        `Conflit : seulement ${available} unité(s) disponible(s) (déjà sorti(s) sur : ${conflictNames})`,
      );
    }
  }
}
