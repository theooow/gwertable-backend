import { z } from "zod";
import { LIMITS, optionalText, requiredText } from "./limits.js";

export const equipmentItemSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  category: requiredText("La catégorie", LIMITS.shortText),
  ownership: z.enum(["OWNED", "BORROWED", "RENTED"]),
  ownerId: z.string().optional().nullable(),
  supplierId: z.string().min(1).optional().nullable(),
  photoUrl: z.string().min(1).max(LIMITS.url).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  unitPriceCents: z.number().int().min(0).default(0),
  amountInputMode: z.enum(["HT", "TTC"]).default("TTC"),
  vatRateBasisPoints: z.number().int().min(0).max(10000).default(2000),
  rentalCoef: z.number().min(0).default(1),
  quantity: z.number().int().min(1).default(1),
  notes: optionalText("Les notes", LIMITS.longText),
});

export const equipmentUsageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("library"),
    itemId: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
    unitPriceCents: z.number().int().min(0).optional(),
    amountInputMode: z.enum(["HT", "TTC"]).optional(),
    vatRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    rentalCoef: z.number().min(0).optional(),
    notes: optionalText("Les notes", LIMITS.longText),
    quoteId: z.string().optional().nullable(),
  }),
  z.object({
    kind: z.literal("oneoff"),
    name: requiredText("Le nom", LIMITS.name),
    category: requiredText("La catégorie", LIMITS.shortText),
    quantity: z.number().int().min(1).default(1),
    unitPriceCents: z.number().int().min(0).default(0),
    amountInputMode: z.enum(["HT", "TTC"]).default("TTC"),
    vatRateBasisPoints: z.number().int().min(0).max(10000).default(2000),
    rentalCoef: z.number().min(0).default(1),
    notes: optionalText("Les notes", LIMITS.longText),
    quoteId: z.string().optional().nullable(),
  }),
]);

export const equipmentUsageUpdateSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  amountInputMode: z.enum(["HT", "TTC"]).optional(),
  vatRateBasisPoints: z.number().int().min(0).max(10000).optional(),
  rentalCoef: z.number().min(0).optional(),
  quoteId: z.string().optional().nullable(),
  conditionBefore: z.string().optional().nullable(),
  conditionAfter: z.string().optional().nullable(),
  returned: z.boolean().optional(),
  notes: optionalText("Les notes", LIMITS.longText),
});

export const equipmentBulkImportSchema = z.object({
  createQuotesBySupplier: z.boolean().default(false),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
    unitPriceCents: z.number().int().min(0).optional(),
    amountInputMode: z.enum(["HT", "TTC"]).optional(),
    vatRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    rentalCoef: z.number().min(0).optional(),
    notes: optionalText("Les notes", LIMITS.longText),
    quoteId: z.string().optional().nullable(),
  })).min(1).max(100),
});

export const equipmentQuoteSchema = z.object({
  label: requiredText("Le libellé", LIMITS.name),
  amountInputMode: z.enum(["HT", "TTC"]).default("TTC"),
  vatRateBasisPoints: z.number().int().min(0).max(10000).default(2000),
  discountCents: z.number().int().min(0).optional().nullable(),
  discountPct: z.number().min(0).max(100).optional().nullable(),
});

export const equipmentImportLineSchema = z.object({
  name: requiredText("Le nom", LIMITS.name),
  category: requiredText("La catÃ©gorie", LIMITS.shortText).default("location"),
  quantity: z.number().int().min(1).default(1),
  unitPriceCents: z.number().int().min(0).default(0),
  amountInputMode: z.enum(["HT", "TTC"]).default("TTC"),
  vatRateBasisPoints: z.number().int().min(0).max(10000).default(2000),
  rentalCoef: z.number().min(0).default(1),
  matchedItemId: z.string().optional().nullable(),
  createCatalogItem: z.boolean().optional().default(false),
  supplierId: z.string().optional().nullable(),
  createSupplierName: optionalText("Le fournisseur", LIMITS.name),
  notes: optionalText("Les notes", LIMITS.longText),
  confidence: z.number().min(0).max(1).optional(),
});

export const equipmentImportPreviewSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  data: z.string().min(1),
});

export const equipmentImportConfirmSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  data: z.string().min(1),
  label: requiredText("Le libellÃ©", LIMITS.name),
  documentType: z.enum(["quote", "invoice", "unknown"]).default("unknown"),
  supplierName: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  createSupplierName: optionalText("Le fournisseur", LIMITS.name),
  amountInputMode: z.enum(["HT", "TTC"]).default("TTC"),
  vatRateBasisPoints: z.number().int().min(0).max(10000).default(2000),
  discountCents: z.number().int().min(0).optional().nullable(),
  discountPct: z.number().min(0).max(100).optional().nullable(),
  lines: z.array(equipmentImportLineSchema).min(1),
});

export type EquipmentItemInput = z.infer<typeof equipmentItemSchema>;
export type EquipmentUsageInput = z.infer<typeof equipmentUsageSchema>;
export type EquipmentUsageUpdateInput = z.infer<typeof equipmentUsageUpdateSchema>;
export type EquipmentBulkImportInput = z.infer<typeof equipmentBulkImportSchema>;
export type EquipmentQuoteInput = z.infer<typeof equipmentQuoteSchema>;
export type EquipmentImportPreviewInput = z.infer<typeof equipmentImportPreviewSchema>;
export type EquipmentImportConfirmInput = z.infer<typeof equipmentImportConfirmSchema>;
export type EquipmentImportLineInput = z.infer<typeof equipmentImportLineSchema>;
