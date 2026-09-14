import { z } from "zod";
import { prisma } from "../prisma.js";
import { NotFoundError, ValidationError } from "../lib/errors.js";
const money = z.coerce.number().nonnegative().max(9_999_999).transform((value) => Math.round(value * 100));
const date = z.string().datetime().optional().or(z.literal(""));
const issuerSchema = z.object({
  legalName: z.string(), siren: z.string().nullable(), siret: z.string().nullable(),
  vatNumber: z.string().nullable(), peppolEndpoint: z.string().nullable(), peppolEndpointScheme: z.string().nullable(),
  addressLine1: z.string().nullable(), addressLine2: z.string().nullable(), postalCode: z.string().nullable(), city: z.string().nullable(), countryCode: z.string(),
});
export function invoiceIssuer(snapshot: unknown, current: unknown) {
  const parsed = issuerSchema.safeParse(snapshot ?? current);
  return parsed.success ? parsed.data : null;
}
export const invoiceSchema = z.object({ direction: z.enum(["OUTGOING", "INCOMING"]), status: z.enum(["DRAFT", "ISSUED", "RECEIVED", "PARTIALLY_PAID", "PAID", "CANCELLED"]).default("DRAFT"), number: z.string().trim().max(80).optional().or(z.literal("")), counterpartName: z.string().trim().min(1).max(200), counterpartEmail: z.string().email().optional().or(z.literal("")), counterpartSiren: z.string().regex(/^\d{9}$/).optional().or(z.literal("")), counterpartPeppolEndpoint: z.string().trim().max(200).optional().or(z.literal("")), counterpartPeppolEndpointScheme: z.string().trim().max(32).optional().or(z.literal("")), eventId: z.string().min(1).optional().or(z.literal("")), issuedAt: date, dueAt: date, notes: z.string().trim().max(4000).optional().or(z.literal("")), lines: z.array(z.object({ label: z.string().trim().min(1).max(200), quantity: z.coerce.number().positive().max(100000).default(1), unitPriceHt: money, vatRateBasisPoints: z.coerce.number().int().min(0).max(10000).default(0) })).min(1).max(100) });

export function invoiceData(data: z.infer<typeof invoiceSchema>) {
  const lines = data.lines.map((line, position) => {
    const totalHtCents = Math.round(line.unitPriceHt * line.quantity);
    const totalVatCents = Math.round(totalHtCents * line.vatRateBasisPoints / 10000);
    return { label: line.label, quantity: line.quantity, unitPriceHtCents: line.unitPriceHt, vatRateBasisPoints: line.vatRateBasisPoints, position, totalHtCents, totalVatCents, totalTtcCents: totalHtCents + totalVatCents };
  });
  if (lines.reduce((sum, line) => sum + line.totalTtcCents, 0) > 2_147_483_647) throw new ValidationError("Le montant total de la facture est trop élevé");
  if (data.issuedAt && data.dueAt && data.dueAt < data.issuedAt) throw new ValidationError("L'échéance doit suivre la date de facture");
  return {
    counterpartName: data.counterpartName, counterpartEmail: data.counterpartEmail || null,
    counterpartSiren: data.counterpartSiren || null,
    counterpartPeppolEndpoint: data.counterpartPeppolEndpoint || null,
    counterpartPeppolEndpointScheme: data.counterpartPeppolEndpointScheme || null,
    dueAt: data.dueAt ? new Date(data.dueAt) : null, notes: data.notes || null,
    totalHtCents: lines.reduce((sum, line) => sum + line.totalHtCents, 0),
    totalVatCents: lines.reduce((sum, line) => sum + line.totalVatCents, 0),
    totalTtcCents: lines.reduce((sum, line) => sum + line.totalTtcCents, 0),
    lines: { create: lines },
  };
}

export async function issueInvoice(id: string, workspaceId: string) {
  return prisma.$transaction(async (tx) => {
    // Serialize numbering and draft edits within the issuing workspace.
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({ where: { id, workspaceId, direction: "OUTGOING" }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!invoice) throw new NotFoundError("Facture introuvable");
    if (invoice.status === "CANCELLED") throw new ValidationError("Cette facture est annulée");
    if (invoice.status !== "DRAFT") return invoice;
    const legal = await tx.legalEntity.findUnique({ where: { workspaceId } });
    if (!legal?.legalName || !legal.siren) throw new ValidationError("Renseignez l'entreprise émettrice et son SIREN dans les paramètres de facturation");
    const issuedAt = new Date();
    if (invoice.dueAt && invoice.dueAt.toISOString().slice(0, 10) < issuedAt.toISOString().slice(0, 10)) throw new ValidationError("Corrigez l'échéance du brouillon : elle est antérieure à aujourd'hui");
    const prefix = `FAC-${issuedAt.getUTCFullYear()}-`;
    const numbers = await tx.invoice.findMany({ where: { workspaceId, number: { startsWith: prefix } }, select: { number: true } });
    const sequence = numbers.reduce((max, item) => {
      const suffix = item.number!.slice(prefix.length);
      return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
    }, 0) + 1;
    return tx.invoice.update({ where: { id }, data: { number: `${prefix}${String(sequence).padStart(4, "0")}`, issuedAt, status: "ISSUED", issuerSnapshot: issuerSchema.parse(legal) }, include: { lines: { orderBy: { position: "asc" } } } });
  });
}
