import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { requireCan } from "../lib/permissions.js";
import { sendInvoiceEmail } from "../lib/mailer.js";
import { renderInvoicePdf } from "../services/invoice-pdf.service.js";
import { invoiceData, invoiceSchema, invoiceIssuer, issueInvoice } from "../services/invoice.service.js";
import { getVerifiedCompany, workspaceAccessToken } from "../services/super-pdp.service.js";
import { buildUblInvoice } from "../services/ubl-invoice.service.js";

const money = z.coerce.number().nonnegative().max(9_999_999).transform((value) => Math.round(value * 100));
const date = z.string().datetime().optional().or(z.literal(""));
const claimSchema = z.object({ label: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(80).default("autre"), analyticCode: z.string().trim().min(1).max(50), amountHt: money, vatRateBasisPoints: z.coerce.number().int().min(0).max(10000).default(0), eventId: z.string().min(1).optional().or(z.literal("")), purchasedAt: date, receiptUrl: z.string().url().optional().or(z.literal("")), notes: z.string().trim().max(4000).optional().or(z.literal("")) });

const idSchema = z.object({ id: z.string().min(1) });

async function ensureEvent(eventId: string | undefined, workspaceId: string) {
  if (!eventId) return null;
  const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId }, select: { id: true } });
  if (!event) throw new ValidationError("L'événement sélectionné n'appartient pas à cet espace");
  return event.id;
}

export async function financeRoutes(fastify: FastifyInstance) {
  fastify.get("/api/finance/invoices/:id", { config: { documentation: { params: idSchema } } }, async (request) => { requireCan(request.userRole, "finance.read"); const { id } = idSchema.parse(request.params); const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId }, include: { lines: { orderBy: { position: "asc" } } } }); if (!invoice) throw new NotFoundError("Facture introuvable"); return invoice; });
  fastify.get("/api/finance/invoices/:id/pdf", { config: { documentation: { params: idSchema } } }, async (request, reply) => { requireCan(request.userRole, "finance.read"); const { id } = idSchema.parse(request.params); const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId }, include: { lines: { orderBy: { position: "asc" } } } }); if (!invoice) throw new NotFoundError("Facture introuvable"); const legal = await prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } }); const pdf = await renderInvoicePdf(invoice, invoiceIssuer(invoice.issuerSnapshot, legal)); return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename=${invoice.number ?? "facture"}.pdf`).send(pdf); });
  fastify.get("/api/finance/overview", { config: { documentation: {  } } }, async (request) => {
    requireCan(request.userRole, "finance.read");
    const [invoices, claims] = await Promise.all([
      prisma.invoice.findMany({ where: { workspaceId: request.workspaceId }, include: { event: { select: { id: true, name: true } }, lines: true }, orderBy: { updatedAt: "desc" } }),
      prisma.expenseClaim.findMany({ where: { workspaceId: request.workspaceId }, include: { event: { select: { id: true, name: true } }, submitter: { select: { id: true, name: true, email: true } }, expense: { select: { id: true, reimbursement: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    return { invoices, claims };
  });

  fastify.get("/api/finance/events", { config: { documentation: {  } } }, async (request) => {
    requireCan(request.userRole, "expenseClaim.create");
    return prisma.event.findMany({ where: { workspaceId: request.workspaceId, status: { not: "ARCHIVED" } }, select: { id: true, name: true, startsAt: true }, orderBy: { startsAt: "desc" } });
  });
  fastify.get("/api/finance/analytics", { config: { documentation: {  } } }, async (request) => { requireCan(request.userRole, "expenseClaim.create"); const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: request.workspaceId }, select: { expenseClaimAnalytics: true } }); return workspace.expenseClaimAnalytics; });
  fastify.put("/api/finance/analytics", { config: { documentation: { body: z.object({ values: z.array(z.string().trim().min(1).max(50)).min(1).max(50) }) } } }, async (request) => { requireCan(request.userRole, "finance.write"); const values = z.object({ values: z.array(z.string().trim().min(1).max(50)).min(1).max(50) }).parse(request.body).values; return prisma.workspace.update({ where: { id: request.workspaceId }, data: { expenseClaimAnalytics: [...new Set(values)] }, select: { expenseClaimAnalytics: true } }); });

  fastify.get("/api/expense-claims/mine", { config: { documentation: {  } } }, async (request) => prisma.expenseClaim.findMany({ where: { workspaceId: request.workspaceId, submitterId: request.user!.id }, include: { event: { select: { id: true, name: true } }, expense: { select: { id: true, reimbursement: true } } }, orderBy: { createdAt: "desc" } }));

  fastify.post("/api/expense-claims", { config: { documentation: { body: claimSchema, statusCodes: [201] } } }, async (request, reply) => {
    requireCan(request.userRole, "expenseClaim.create");
    const data = claimSchema.parse(request.body); const eventId = await ensureEvent(data.eventId || undefined, request.workspaceId); const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: request.workspaceId }, select: { expenseClaimAnalytics: true } }); if (!workspace.expenseClaimAnalytics.includes(data.analyticCode)) throw new ValidationError("Axe analytique invalide");
    const vat = Math.round(data.amountHt * data.vatRateBasisPoints / 10000);
    const claim = await prisma.expenseClaim.create({ data: { workspaceId: request.workspaceId, submitterId: request.user!.id, eventId, label: data.label, category: data.category, analyticCode: data.analyticCode, amountHtCents: data.amountHt, amountVatCents: vat, amountTtcCents: data.amountHt + vat, vatRateBasisPoints: data.vatRateBasisPoints, purchasedAt: data.purchasedAt ? new Date(data.purchasedAt) : null, receiptUrl: data.receiptUrl || null, notes: data.notes || null } });
    return reply.status(201).send(claim);
  });

  fastify.post("/api/expense-claims/:id/approve", { config: { documentation: { params: idSchema } } }, async (request) => {
    requireCan(request.userRole, "finance.write"); const { id } = idSchema.parse(request.params);
    const claim = await prisma.expenseClaim.findFirst({ where: { id, workspaceId: request.workspaceId }, include: { submitter: true } });
    if (!claim) throw new NotFoundError("Note de frais introuvable"); if (claim.status !== "SUBMITTED") throw new ValidationError("Cette note de frais a déjà été traitée");
    return prisma.$transaction(async (tx) => {
      let personId = claim.submitter.personId;
      if (!personId) { const existingPerson = await tx.person.findUnique({ where: { workspaceId_email: { workspaceId: request.workspaceId, email: claim.submitter.email } }, select: { id: true } }); const person = existingPerson ?? await tx.person.create({ data: { workspaceId: request.workspaceId, fullName: claim.submitter.name || claim.submitter.email, email: claim.submitter.email, tags: [] } }); personId = person.id; await tx.user.update({ where: { id: claim.submitterId }, data: { personId } }); }
      const approved = await tx.expenseClaim.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date() } });
      if (!claim.eventId) return approved;
      const expense = await tx.expense.create({ data: { eventId: claim.eventId, expenseClaimId: id, label: claim.label, amountCents: claim.amountTtcCents, phase: "ACTUAL", amountInputMode: "TTC", vatRateBasisPoints: claim.vatRateBasisPoints, amountHtCents: claim.amountHtCents, amountVatCents: claim.amountVatCents, amountTtcCents: claim.amountTtcCents, category: claim.category, paidById: personId, paidAt: claim.purchasedAt, reimbursement: "PENDING", receiptUrl: claim.receiptUrl, notes: claim.notes } });
      return { ...approved, expense };
    });
  });

  fastify.post("/api/finance/invoices", { config: { documentation: { body: invoiceSchema, statusCodes: [201] } } }, async (request, reply) => {
    requireCan(request.userRole, "finance.write"); const data = invoiceSchema.parse(request.body); const eventId = await ensureEvent(data.eventId || undefined, request.workspaceId);
    if (data.direction === "OUTGOING" && (data.status !== "DRAFT" || data.number)) throw new ValidationError("Créez un brouillon : le numéro sera attribué à l'émission");
    const invoice = await prisma.invoice.create({ data: { ...invoiceData(data), workspaceId: request.workspaceId, eventId, direction: data.direction, status: data.status, number: data.number || null, issuedAt: data.direction === "INCOMING" && data.issuedAt ? new Date(data.issuedAt) : null }, include: { lines: true } });
    return reply.status(201).send(invoice);
  });

  fastify.put("/api/finance/invoices/:id", { config: { documentation: { params: idSchema, body: invoiceSchema } } }, async (request) => {
    requireCan(request.userRole, "finance.write");
    const { id } = idSchema.parse(request.params);
    const data = invoiceSchema.parse(request.body);
    const eventId = await ensureEvent(data.eventId || undefined, request.workspaceId);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${request.workspaceId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id, workspaceId: request.workspaceId, direction: "OUTGOING" } });
      if (!invoice) throw new NotFoundError("Facture introuvable");
      if (invoice.status !== "DRAFT" || invoice.superPdpSentAt) throw new ValidationError("Seuls les brouillons peuvent être modifiés");
      if (data.direction !== "OUTGOING" || data.status !== "DRAFT" || data.number) throw new ValidationError("Un brouillon ne peut pas être émis par modification");
      const values = invoiceData(data);
      return tx.invoice.update({ where: { id }, data: { ...values, eventId, lines: { deleteMany: {}, create: values.lines.create } }, include: { lines: true } });
    });
  });

  fastify.post("/api/finance/invoices/:id/issue", { config: { documentation: { params: idSchema } } }, async (request) => {
    requireCan(request.userRole, "finance.write");
    return issueInvoice(idSchema.parse(request.params).id, request.workspaceId);
  });

  fastify.post("/api/finance/invoices/:id/send", { config: { documentation: { params: idSchema } } }, async (request) => {
    requireCan(request.userRole, "finance.write");
    const { id } = idSchema.parse(request.params);
    const current = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId, direction: "OUTGOING" } });
    if (!current) throw new NotFoundError("Facture introuvable");
    if (!current.counterpartEmail) throw new ValidationError("Ajoutez l'email du client avant l'envoi");
    const invoice = await issueInvoice(id, request.workspaceId);
    const legal = await prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } });
    if (!legal?.legalName) throw new ValidationError("Renseignez l'entreprise émettrice");
    const pdf = await renderInvoicePdf(invoice, invoiceIssuer(invoice.issuerSnapshot, legal));
    await sendInvoiceEmail({ email: invoice.counterpartEmail!, customerName: invoice.counterpartName, number: invoice.number!, pdf });
    return invoice;
  });

  fastify.post("/api/finance/invoices/:id/transmit-super-pdp", { config: { documentation: { params: idSchema } } }, async (request) => {
    requireCan(request.userRole, "finance.write"); const { id } = idSchema.parse(request.params);
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId, direction: "OUTGOING" }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!invoice) throw new NotFoundError("Facture introuvable"); if (!invoice.number) throw new ValidationError("Envoyez d'abord la facture pour lui attribuer un numéro"); if (!invoice.counterpartSiren) throw new ValidationError("Le SIREN du client est requis pour transmettre une facture B2B à Super PDP");
    const [currentLegal, connection] = await Promise.all([prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } }), prisma.electronicInvoicingConnection.findUnique({ where: { workspaceId_provider: { workspaceId: request.workspaceId, provider: "SUPER_PDP" } } })]);
    const legal = invoiceIssuer(invoice.issuerSnapshot, currentLegal);
    if (!legal?.siren || !connection?.accessToken || connection.status !== "CONNECTED") throw new ValidationError("Connectez Super PDP et renseignez le SIREN de l'entité légale avant transmission");
    if (invoice.totalVatCents > 0 && !legal.vatNumber) throw new ValidationError("Cette facture comporte de la TVA, mais le numéro de TVA intracommunautaire du vendeur n'est pas renseigné. Renseignez-le dans Paramètres > Facturation électronique, ou créez une facture à 0 % avec la mention \"TVA non applicable, article 293 B du CGI\" si votre structure est en franchise de TVA.");
    const accessToken = await workspaceAccessToken(request.workspaceId);
    const company = await getVerifiedCompany(accessToken, legal.siren);
    if (String(company.id) !== connection.providerOrgId) throw new ValidationError("L'entreprise connectée a changé. Reconnectez Super PDP.");
    const ubl = buildUblInvoice({ ...invoice, number: invoice.number!, counterpartSiren: invoice.counterpartSiren!, issuedAt: invoice.issuedAt ?? new Date() }, { ...legal, siren: legal.siren! });
    const claimed = await prisma.invoice.updateMany({ where: { id, workspaceId: request.workspaceId, superPdpSentAt: null, OR: [{ superPdpStatus: null }, { superPdpStatus: { not: "TRANSMITTING" } }] }, data: { superPdpStatus: "TRANSMITTING", superPdpError: null } });
    if (claimed.count !== 1) throw new ValidationError("Une transmission est déjà en cours");
    // A network timeout leaves TRANSMITTING: do not retry a potentially accepted invoice automatically.
    const response = await fetch(`https://api.superpdp.tech/v1.beta/invoices?external_id=${encodeURIComponent(invoice.id)}`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/xml", accept: "application/json" }, body: ubl, signal: AbortSignal.timeout(30000) });
    const rawBody = await response.text(); const body = (() => { try { return JSON.parse(rawBody) as { data?: Array<{ id?: number }>; message?: string }; } catch { return null; } })();
    if (!response.ok) { const error = body?.message ?? `Super PDP HTTP ${response.status}${rawBody ? ` : ${rawBody.slice(0, 500)}` : ""}`; await prisma.invoice.update({ where: { id }, data: { superPdpStatus: "ERROR", superPdpError: error } }); throw new ValidationError(error); }
    return prisma.invoice.update({ where: { id }, data: { superPdpInvoiceId: body?.data?.[0]?.id ?? (body as { id?: number } | null)?.id ?? null, superPdpStatus: "QUEUED", superPdpError: null, superPdpSentAt: new Date() } });
  });
}
