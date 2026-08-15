import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { requireCan } from "../lib/permissions.js";
import { sendInvoiceEmail } from "../lib/mailer.js";
import { renderInvoicePdf } from "../services/invoice-pdf.service.js";
import { decryptCredential } from "../lib/encrypted-credentials.js";
import { buildUblInvoice } from "../services/ubl-invoice.service.js";

const money = z.coerce.number().nonnegative().max(9_999_999).transform((value) => Math.round(value * 100));
const date = z.string().datetime().optional().or(z.literal(""));
const claimSchema = z.object({ label: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(80).default("autre"), analyticCode: z.string().trim().min(1).max(50), amountHt: money, vatRateBasisPoints: z.coerce.number().int().min(0).max(10000).default(0), eventId: z.string().min(1).optional().or(z.literal("")), purchasedAt: date, receiptUrl: z.string().url().optional().or(z.literal("")), notes: z.string().trim().max(4000).optional().or(z.literal("")) });
const invoiceSchema = z.object({ direction: z.enum(["OUTGOING", "INCOMING"]), status: z.enum(["DRAFT", "ISSUED", "RECEIVED", "PARTIALLY_PAID", "PAID", "CANCELLED"]).default("DRAFT"), number: z.string().trim().max(80).optional().or(z.literal("")), counterpartName: z.string().trim().min(1).max(200), counterpartEmail: z.string().email().optional().or(z.literal("")), counterpartSiren: z.string().regex(/^\d{9}$/).optional().or(z.literal("")), counterpartPeppolEndpoint: z.string().trim().max(200).optional().or(z.literal("")), counterpartPeppolEndpointScheme: z.string().trim().max(32).optional().or(z.literal("")), eventId: z.string().min(1).optional().or(z.literal("")), issuedAt: date, dueAt: date, notes: z.string().trim().max(4000).optional().or(z.literal("")), lines: z.array(z.object({ label: z.string().trim().min(1).max(200), quantity: z.coerce.number().positive().max(100000).default(1), unitPriceHt: money, vatRateBasisPoints: z.coerce.number().int().min(0).max(10000).default(0) })).min(1).max(100) });
const idSchema = z.object({ id: z.string().min(1) });

async function ensureEvent(eventId: string | undefined, workspaceId: string) {
  if (!eventId) return null;
  const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId }, select: { id: true } });
  if (!event) throw new ValidationError("L'événement sélectionné n'appartient pas à cet espace");
  return event.id;
}

export async function financeRoutes(fastify: FastifyInstance) {
  fastify.get("/api/finance/invoices/:id", async (request) => { requireCan(request.userRole, "finance.read"); const { id } = idSchema.parse(request.params); const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId }, include: { lines: { orderBy: { position: "asc" } } } }); if (!invoice) throw new NotFoundError("Facture introuvable"); return invoice; });
  fastify.get("/api/finance/invoices/:id/pdf", async (request, reply) => { requireCan(request.userRole, "finance.read"); const { id } = idSchema.parse(request.params); const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId }, include: { lines: { orderBy: { position: "asc" } } } }); if (!invoice) throw new NotFoundError("Facture introuvable"); const legal = await prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } }); const pdf = await renderInvoicePdf(invoice, legal?.legalName ?? "Abregi"); return reply.header("content-type", "application/pdf").header("content-disposition", `attachment; filename=${invoice.number ?? "facture"}.pdf`).send(pdf); });
  fastify.get("/api/finance/overview", async (request) => {
    requireCan(request.userRole, "finance.read");
    const [invoices, claims] = await Promise.all([
      prisma.invoice.findMany({ where: { workspaceId: request.workspaceId }, include: { event: { select: { id: true, name: true } }, lines: true }, orderBy: { updatedAt: "desc" } }),
      prisma.expenseClaim.findMany({ where: { workspaceId: request.workspaceId }, include: { event: { select: { id: true, name: true } }, submitter: { select: { id: true, name: true, email: true } }, expense: { select: { id: true, reimbursement: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    return { invoices, claims };
  });

  fastify.get("/api/finance/events", async (request) => {
    requireCan(request.userRole, "expenseClaim.create");
    return prisma.event.findMany({ where: { workspaceId: request.workspaceId, status: { not: "ARCHIVED" } }, select: { id: true, name: true, startsAt: true }, orderBy: { startsAt: "desc" } });
  });
  fastify.get("/api/finance/analytics", async (request) => { requireCan(request.userRole, "expenseClaim.create"); const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: request.workspaceId }, select: { expenseClaimAnalytics: true } }); return workspace.expenseClaimAnalytics; });
  fastify.put("/api/finance/analytics", async (request) => { requireCan(request.userRole, "finance.write"); const values = z.object({ values: z.array(z.string().trim().min(1).max(50)).min(1).max(50) }).parse(request.body).values; return prisma.workspace.update({ where: { id: request.workspaceId }, data: { expenseClaimAnalytics: [...new Set(values)] }, select: { expenseClaimAnalytics: true } }); });

  fastify.get("/api/expense-claims/mine", async (request) => prisma.expenseClaim.findMany({ where: { workspaceId: request.workspaceId, submitterId: request.user!.id }, include: { event: { select: { id: true, name: true } }, expense: { select: { id: true, reimbursement: true } } }, orderBy: { createdAt: "desc" } }));

  fastify.post("/api/expense-claims", async (request, reply) => {
    requireCan(request.userRole, "expenseClaim.create");
    const data = claimSchema.parse(request.body); const eventId = await ensureEvent(data.eventId || undefined, request.workspaceId); const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: request.workspaceId }, select: { expenseClaimAnalytics: true } }); if (!workspace.expenseClaimAnalytics.includes(data.analyticCode)) throw new ValidationError("Axe analytique invalide");
    const vat = Math.round(data.amountHt * data.vatRateBasisPoints / 10000);
    const claim = await prisma.expenseClaim.create({ data: { workspaceId: request.workspaceId, submitterId: request.user!.id, eventId, label: data.label, category: data.category, analyticCode: data.analyticCode, amountHtCents: data.amountHt, amountVatCents: vat, amountTtcCents: data.amountHt + vat, vatRateBasisPoints: data.vatRateBasisPoints, purchasedAt: data.purchasedAt ? new Date(data.purchasedAt) : null, receiptUrl: data.receiptUrl || null, notes: data.notes || null } });
    return reply.status(201).send(claim);
  });

  fastify.post("/api/expense-claims/:id/approve", async (request) => {
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

  fastify.post("/api/finance/invoices", async (request, reply) => {
    requireCan(request.userRole, "finance.write"); const data = invoiceSchema.parse(request.body); const eventId = await ensureEvent(data.eventId || undefined, request.workspaceId);
    const lines = data.lines.map((line, position) => { const ht = Math.round(line.unitPriceHt * line.quantity); const vat = Math.round(ht * line.vatRateBasisPoints / 10000); return { ...line, position, totalHtCents: ht, totalVatCents: vat, totalTtcCents: ht + vat, unitPriceHtCents: line.unitPriceHt }; });
    const invoice = await prisma.invoice.create({ data: { workspaceId: request.workspaceId, eventId, direction: data.direction, status: data.status, number: data.number || null, counterpartName: data.counterpartName, counterpartEmail: data.counterpartEmail || null, counterpartSiren: data.counterpartSiren || null, counterpartPeppolEndpoint: data.counterpartPeppolEndpoint || null, counterpartPeppolEndpointScheme: data.counterpartPeppolEndpointScheme || null, issuedAt: data.issuedAt ? new Date(data.issuedAt) : null, dueAt: data.dueAt ? new Date(data.dueAt) : null, notes: data.notes || null, totalHtCents: lines.reduce((sum, line) => sum + line.totalHtCents, 0), totalVatCents: lines.reduce((sum, line) => sum + line.totalVatCents, 0), totalTtcCents: lines.reduce((sum, line) => sum + line.totalTtcCents, 0), lines: { create: lines.map(({ label, quantity, unitPriceHtCents, vatRateBasisPoints, totalHtCents, totalVatCents, totalTtcCents, position }) => ({ label, quantity, unitPriceHtCents, vatRateBasisPoints, totalHtCents, totalVatCents, totalTtcCents, position })) } }, include: { lines: true } });
    return reply.status(201).send(invoice);
  });

  fastify.post("/api/finance/invoices/:id/send", async (request) => {
    requireCan(request.userRole, "finance.write"); const { id } = idSchema.parse(request.params);
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId, direction: "OUTGOING" }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!invoice) throw new NotFoundError("Facture introuvable"); if (!invoice.counterpartEmail) throw new ValidationError("Ajoutez l'email du client avant l'envoi");
    const number = invoice.number ?? `FAC-${new Date().getFullYear()}-${String(await prisma.invoice.count({ where: { workspaceId: request.workspaceId, direction: "OUTGOING" } })).padStart(4, "0")}`;
    const legal = await prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } }); const issuedAt = invoice.issuedAt ?? new Date();
    const pdf = await renderInvoicePdf({ ...invoice, number, issuedAt }, legal?.legalName ?? "Abregi"); await sendInvoiceEmail({ email: invoice.counterpartEmail, customerName: invoice.counterpartName, number, pdf });
    return prisma.invoice.update({ where: { id }, data: { number, issuedAt, status: "ISSUED" } });
  });

  fastify.post("/api/finance/invoices/:id/transmit-super-pdp", async (request) => {
    requireCan(request.userRole, "finance.write"); const { id } = idSchema.parse(request.params);
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId: request.workspaceId, direction: "OUTGOING" }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!invoice) throw new NotFoundError("Facture introuvable"); if (!invoice.number) throw new ValidationError("Envoyez d'abord la facture pour lui attribuer un numéro"); if (!invoice.counterpartSiren) throw new ValidationError("Le SIREN du client est requis pour transmettre une facture B2B à Super PDP");
    const [legal, connection] = await Promise.all([prisma.legalEntity.findUnique({ where: { workspaceId: request.workspaceId } }), prisma.electronicInvoicingConnection.findUnique({ where: { workspaceId_provider: { workspaceId: request.workspaceId, provider: "SUPER_PDP" } } })]);
    if (!legal?.siren || !connection?.accessToken || connection.status !== "CONNECTED") throw new ValidationError("Connectez Super PDP et renseignez le SIREN de l'entité légale avant transmission");
    if (invoice.totalVatCents > 0 && !legal.vatNumber) throw new ValidationError("Cette facture comporte de la TVA, mais le numéro de TVA intracommunautaire du vendeur n'est pas renseigné. Renseignez-le dans Paramètres > Facturation électronique, ou créez une facture à 0 % avec la mention \"TVA non applicable, article 293 B du CGI\" si votre structure est en franchise de TVA.");
    const ubl = buildUblInvoice({ ...invoice, number: invoice.number!, counterpartSiren: invoice.counterpartSiren!, issuedAt: invoice.issuedAt ?? new Date() }, { ...legal, siren: legal.siren! });
    const response = await fetch(`https://api.superpdp.tech/v1.beta/invoices?external_id=${encodeURIComponent(invoice.id)}`, { method: "POST", headers: { authorization: `Bearer ${decryptCredential(connection.accessToken)}`, "content-type": "application/xml", accept: "application/json" }, body: ubl });
    const rawBody = await response.text(); const body = (() => { try { return JSON.parse(rawBody) as { data?: Array<{ id?: number }>; message?: string }; } catch { return null; } })();
    if (!response.ok) { const error = body?.message ?? `Super PDP HTTP ${response.status}${rawBody ? ` : ${rawBody.slice(0, 500)}` : ""}`; await prisma.invoice.update({ where: { id }, data: { superPdpStatus: "ERROR", superPdpError: error } }); throw new ValidationError(error); }
    return prisma.invoice.update({ where: { id }, data: { superPdpInvoiceId: body?.data?.[0]?.id ?? (body as { id?: number } | null)?.id ?? null, superPdpStatus: "QUEUED", superPdpError: null, superPdpSentAt: new Date() } });
  });
}
