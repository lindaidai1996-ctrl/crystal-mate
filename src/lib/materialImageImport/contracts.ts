import { z } from 'zod';
import { catalogAliasesSchema, materialSchema, materialPurchaseSchema } from '@/lib/validation';
import {
  importSourceKeyPattern,
  importCropKeyPattern,
  imageObjectKeyPattern,
} from '@/lib/image-storage';

// All providers use the same top-left origin and 0–1000 coordinate space.
export const importBoxSchema = z
  .strictObject({
    x: z.number().min(0).max(999),
    y: z.number().min(0).max(999),
    width: z.number().positive().max(1000),
    height: z.number().positive().max(1000),
  })
  .refine((box) => box.x + box.width <= 1000 && box.y + box.height <= 1000);

export const importMoneySchema = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
  .nullable();
// Drafts allow incomplete names/categories; final submission uses materialCreateSchema.
export const importMaterialDraftSchema = z.strictObject({
  values: z.strictObject({
    ...z.strictObject(materialSchema.shape).omit({ imageKeys: true }).shape,
    aliases: catalogAliasesSchema.default([]),
    name: z.string().max(120),
    categoryId: z.string().max(100),
  }),
  purchase: materialPurchaseSchema,
  quantityUnknown: z.boolean(),
  tagIds: z.array(z.string().cuid()).max(100),
  images: z
    .array(
      z.strictObject({
        id: z.string().optional(),
        objectKey: z.string().regex(imageObjectKeyPattern).startsWith('images/'),
        url: z.string().min(1),
        position: z.number().int().nonnegative(),
      }),
    )
    .max(11),
});

export const importItemDataSchema = z.strictObject({
  objectBox: importBoxSchema,
  priceBox: importBoxSchema.nullable(),
  priceText: z.string().max(200),
  price: importMoneySchema,
  warnings: z.array(z.string().max(300)).max(10),
  name: z.string().max(120),
  categoryId: z.string().max(100),
  existingMaterialId: z.string().cuid().nullable(),
  unit: z.enum(['BEAD', 'GRAM', 'STRAND']),
  priceKind: z.enum(['PURCHASE', 'SALE']),
  purchasePrice: importMoneySchema,
  salePrice: importMoneySchema,
  quantity: z.number().positive().max(2147483647).nullable(),
  selected: z.boolean(),
  reviewed: z.boolean(),
  material: importMaterialDraftSchema.optional(),
});
export const importSettingsSchema = z.strictObject({
  distributorId: z.string().max(100),
  selection: z
    .union([
      z.strictObject({ batchId: z.string().cuid() }),
      z.strictObject({
        newBatch: z.strictObject({
          name: z.string().max(120),
          receivedAt: z.string().max(10),
          notes: z.string().max(10000),
        }),
      }),
    ])
    .nullable(),
  priceKind: z.enum(['PURCHASE', 'SALE']),
});
export const importItemWriteSchema = z.strictObject({
  id: z.uuid(),
  data: importItemDataSchema,
});
export const importDraftSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  settings: importSettingsSchema,
  items: z.array(importItemWriteSchema).max(100),
});
export const deleteImportSchema = z.strictObject({
  version: z.number().int().nonnegative(),
});
export const createImportSchema = z.strictObject({
  sourceKey: z.string().regex(importSourceKeyPattern),
  fileName: z.string().min(1).max(200),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  provider: z.string().min(1).max(60),
  priceKind: z.enum(['PURCHASE', 'SALE']),
});
export const recognizeImportSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  provider: z.string().min(1).max(60),
});
export const recognizeImportItemSchema = recognizeImportSchema.extend({
  itemId: z.uuid(),
  objectBox: importBoxSchema,
  priceBox: importBoxSchema.nullable(),
});
export type ImportRecognitionPreview = {
  itemId: string;
  version: number;
  data: ImportItemData;
};
export const commitImportSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  itemId: z.uuid(),
  imageKey: z.string().regex(importCropKeyPattern),
});

export type ImportMaterialDraft = z.infer<typeof importMaterialDraftSchema>;
export type ImportBox = z.infer<typeof importBoxSchema>;
export type ImportItemData = z.infer<typeof importItemDataSchema>;
export type ImportSettings = z.infer<typeof importSettingsSchema>;
export type ImportItem = {
  id: string;
  data: ImportItemData;
  materialId: string | null;
  entryId: string | null;
};
export type ImageImport = {
  id: string;
  sourceUrl: string;
  fileName: string;
  width: number;
  height: number;
  provider: string;
  model: string;
  status: string;
  version: number;
  updatedAt?: string;
  archivedAt?: string | null;
  settings: ImportSettings;
  warnings: string[];
  errorCode: string | null;
  leaseUntil: string | null;
  items: ImportItem[];
};
export type ImportModelOption = { id: string; label: string; model: string; configured: boolean };

export function newImportItem(
  priceKind: ImportSettings['priceKind'],
  objectBox: ImportBox = { x: 100, y: 100, width: 200, height: 200 },
): ImportItemData {
  return {
    objectBox,
    priceBox: null,
    priceText: '',
    price: null,
    warnings: [],
    name: '',
    categoryId: '',
    existingMaterialId: null,
    unit: 'BEAD',
    priceKind,
    purchasePrice: null,
    salePrice: null,
    quantity: 1,
    selected: true,
    reviewed: false,
  };
}

export function readPrice(text: string): string | null {
  // Reject ambiguous strings, multiple numbers, and guesses such as "4.5 or 9.5".
  const cleaned = text
    .normalize('NFKC')
    .trim()
    .replace(/^[¥￥]\s*/, '')
    .replace(/\s*元$/, '');
  return importMoneySchema.safeParse(cleaned).success ? cleaned : null;
}

export function effectivePrices(item: ImportItemData) {
  return {
    purchase: item.priceKind === 'PURCHASE' ? item.price : item.purchasePrice,
    sale: item.priceKind === 'SALE' ? item.price : item.salePrice,
  };
}
