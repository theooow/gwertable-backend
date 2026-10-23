import type { Prisma } from "@prisma/client";

const ANONYMIZED_EVENT_NAME = "Événement anonymisé";

/** Keeps only "75011 Paris"-like locality from a free address, enough for regional statistics. */
export function localityOf(address: string | null) {
  const match = address?.match(/\b(\d{5})\b\s*([A-Za-zÀ-ÿ' -]*)/);
  return match ? `${match[1]} ${match[2]?.trim() ?? ""}`.trim() : null;
}

/**
 * Irreversibly strips personal data from a workspace while keeping its events usable for statistics:
 * dates, status, genres, locality, capacity, budget amounts and categories, ticketing and consumables.
 * Members must be removed by the caller. Returns uploaded file URLs to delete once the transaction commits.
 */
export async function anonymizeWorkspace(tx: Prisma.TransactionClient, workspaceId: string): Promise<string[]> {
  const inWorkspace = { event: { workspaceId } };
  const [workspace, events, expenses, incomes, attachments, documents, quotes, invoices, claims, personDocuments, items] = await Promise.all([
    tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { logoUrl: true } }),
    tx.event.findMany({ where: { workspaceId }, select: { bannerUrl: true } }),
    tx.expense.findMany({ where: inWorkspace, select: { receiptUrl: true } }),
    tx.income.findMany({ where: inWorkspace, select: { receiptUrl: true } }),
    tx.taskAttachment.findMany({ where: { task: inWorkspace }, select: { url: true } }),
    tx.document.findMany({ where: inWorkspace, select: { url: true } }),
    tx.equipmentQuote.findMany({ where: inWorkspace, select: { fileUrl: true } }),
    tx.invoice.findMany({ where: { workspaceId }, select: { documentUrl: true } }),
    tx.expenseClaim.findMany({ where: { workspaceId }, select: { receiptUrl: true } }),
    tx.personDocument.findMany({ where: { person: { workspaceId }, isUpload: true }, select: { url: true } }),
    tx.equipmentItem.findMany({ where: { workspaceId }, select: { photoUrl: true } }),
  ]);
  const files = [
    workspace.logoUrl, ...events.map((e) => e.bannerUrl), ...expenses.map((e) => e.receiptUrl), ...incomes.map((i) => i.receiptUrl),
    ...attachments.map((a) => a.url), ...documents.map((d) => d.url), ...quotes.map((q) => q.fileUrl), ...invoices.map((i) => i.documentUrl),
    ...claims.map((c) => c.receiptUrl), ...personDocuments.map((d) => d.url), ...items.map((i) => i.photoUrl),
  ].filter((url): url is string => Boolean(url));

  const ofWorkspace = { workspaceId };
  // Budget lines keep amounts and categories; labels may name people, so they fall back to the category.
  await tx.$executeRaw`UPDATE "Expense" SET "label" = "category", "notes" = NULL, "receiptUrl" = NULL, "paidById" = NULL, "sourceParticipantId" = NULL, "expenseClaimId" = NULL WHERE "eventId" IN (SELECT "id" FROM "Event" WHERE "workspaceId" = ${workspaceId})`;
  await tx.$executeRaw`UPDATE "Income" SET "label" = "category", "receiptUrl" = NULL WHERE "eventId" IN (SELECT "id" FROM "Event" WHERE "workspaceId" = ${workspaceId})`;
  await tx.equipmentUsage.updateMany({ where: inWorkspace, data: { conditionBefore: null, conditionAfter: null, notes: null } });
  await tx.eventCollective.updateMany({ where: inWorkspace, data: { name: "Collectif" } });
  await tx.equipmentItem.updateMany({ where: { workspaceId }, data: { photoUrl: null, ownerId: null, supplierId: null } });

  await tx.volunteerContract.deleteMany({ where: { workspaceId } });
  await tx.volunteerApplication.deleteMany({ where: inWorkspace });
  await tx.eventParticipant.deleteMany({ where: inWorkspace });
  await tx.announcement.deleteMany({ where: inWorkspace });
  await tx.task.deleteMany({ where: inWorkspace });
  await tx.taskCategory.deleteMany({ where: inWorkspace });
  await tx.shift.deleteMany({ where: inWorkspace });
  await tx.cateringService.deleteMany({ where: inWorkspace });
  await tx.volunteerForm.deleteMany({ where: inWorkspace });
  await tx.runOfShowItem.deleteMany({ where: inWorkspace });
  await tx.runOfShowSection.deleteMany({ where: inWorkspace });
  await tx.runOfShowTrack.deleteMany({ where: inWorkspace });
  await tx.shoppingItem.deleteMany({ where: inWorkspace });
  await tx.document.deleteMany({ where: inWorkspace });
  await tx.channel.deleteMany({ where: inWorkspace });
  await tx.taskCalendarSubscription.deleteMany({ where: inWorkspace });
  await tx.eventNotificationSettings.deleteMany({ where: inWorkspace });
  await tx.notificationDelivery.deleteMany({ where: inWorkspace });
  await tx.equipmentQuote.deleteMany({ where: inWorkspace });
  await tx.eventCollaborator.deleteMany({ where: ofWorkspace });
  await tx.activityEntry.deleteMany({ where: ofWorkspace });
  await tx.inAppNotification.deleteMany({ where: ofWorkspace });
  await tx.activityNotificationPreference.deleteMany({ where: ofWorkspace });
  await tx.workspaceInvitation.deleteMany({ where: ofWorkspace });
  await tx.invoice.deleteMany({ where: ofWorkspace });
  await tx.expenseClaim.deleteMany({ where: ofWorkspace });
  await tx.fiscalYear.deleteMany({ where: ofWorkspace });
  await tx.legalEntity.deleteMany({ where: ofWorkspace });
  await tx.equipmentImportMatchMemory.deleteMany({ where: ofWorkspace });
  // Venues used by events stay as anonymous places: locality and capacity feed regional statistics.
  const venues = await tx.person.findMany({ where: { workspaceId, venueEvents: { some: {} } }, select: { id: true, address: true } });
  const venueIds = venues.map((venue) => venue.id);
  await tx.personDocument.deleteMany({ where: { personId: { in: venueIds } } });
  await tx.personHistoryNote.deleteMany({ where: { personId: { in: venueIds } } });
  for (const venue of venues) {
    await tx.person.update({ where: { id: venue.id }, data: {
      fullName: "Lieu anonymisé", address: localityOf(venue.address), email: null, phone: null, discordUserId: null, flags: [], tags: [],
      availability: null, negotiatedPrices: null, specialConditions: null, technicalConstraints: null, averageFee: null,
      bookingContact: null, musicalStyle: null, riderNotes: null, soundConstraints: null, openingHours: null,
      electricalPower: null, securityContact: null, archivedAt: new Date(), anonymizedAt: new Date(),
    } });
  }
  await tx.person.deleteMany({ where: { workspaceId, id: { notIn: venueIds } } });
  await tx.supplier.deleteMany({ where: ofWorkspace });

  await tx.event.updateMany({ where: { workspaceId }, data: { name: ANONYMIZED_EVENT_NAME, description: null, bannerUrl: null, shotgunEventId: null } });
  await tx.user.updateMany({ where: { defaultWorkspaceId: workspaceId }, data: { defaultWorkspaceId: null } });
  await tx.workspace.update({ where: { id: workspaceId }, data: {
    name: "Espace anonymisé", logoUrl: null, emailPrimaryColor: null, shotgunOrganizerId: null, shotgunApiToken: null,
    contractIssuer: {}, anonymizedAt: new Date(),
  } });
  return files;
}
