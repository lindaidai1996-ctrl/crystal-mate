import { z } from 'zod';
import { importBoxSchema } from '@/lib/materialImageImport/contracts';
import { importSourceKeyPattern } from '@/lib/image-storage';
import { productDiySchema } from '@/lib/validation';

export const MAX_DIY_IMAGES = 6;
const moneyDraft = z.string().regex(/^(?:|\d{1,10}(?:\.\d{1,2})?)$/);
export const diyImageSchema = z.strictObject({
  id: z.uuid(),
  objectKey: z.string().regex(importSourceKeyPattern),
  url: z.string().max(1000),
  fileName: z.string().min(1).max(200),
  width: z.number().int().positive().max(32768),
  height: z.number().int().positive().max(32768),
});
export const diyViewSchema = z.strictObject({ imageId: z.uuid(), box: importBoxSchema });
export const diyCandidateSchema = z.strictObject({
  id: z.string().cuid(),
  kind: z.enum(['MATERIAL', 'CABOCHON']),
  name: z.string().max(120),
  reason: z.string().max(300),
});
export const diyPartSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().max(120),
  description: z.string().max(1000),
  views: z.array(diyViewSchema).max(MAX_DIY_IMAGES),
  warnings: z.array(z.string().max(300)).max(10),
  candidates: z.array(diyCandidateSchema).max(5),
  kind: z.enum(['MATERIAL', 'CABOCHON']),
  materialId: z.string().cuid().nullable(),
  materialBatchEntryId: z.string().cuid().nullable(),
  cabochonId: z.string().cuid().nullable(),
  usageUnit: z.enum(['BEAD', 'STRAND', 'GRAM']),
  quantity: moneyDraft,
  unitCost: moneyDraft,
  quoteUnitPrice: moneyDraft.nullable(),
  reviewed: z.boolean(),
  excluded: z.boolean(),
});
export const diyDataSchema = z.strictObject({
  name: z.string().max(120),
  categoryId: z.string().max(100),
  code: z.string().max(64),
  codeReservationToken: z.uuid().optional(),
  targetProductId: z.string().cuid().nullable(),
  quantity: z.number().int().positive().max(2147483647),
  hint: z.string().max(2000),
  notes: z.string().max(10000),
  salePrice: moneyDraft,
  silverCost: z.strictObject({
    weightGrams: moneyDraft,
    costGramPrice: moneyDraft,
    quoteGramPrice: moneyDraft,
  }),
  extraCosts: z
    .array(
      z.strictObject({
        name: z.string().max(60),
        amount: moneyDraft,
        quoteAmount: moneyDraft.nullable(),
      }),
    )
    .max(50),
  parts: z.array(diyPartSchema).max(50),
});
export const diyImagesSchema = z
  .array(diyImageSchema)
  .min(1)
  .max(MAX_DIY_IMAGES)
  .refine(
    (images) =>
      new Set(images.map((image) => image.id)).size === images.length &&
      new Set(images.map((image) => image.objectKey)).size === images.length,
  );
export const diyCreateSchema = z.strictObject({
  id: z.uuid(),
  images: diyImagesSchema,
  targetProductId: z.string().cuid().nullable().default(null),
});
export const diySaveSchema = z
  .strictObject({
    version: z.number().int().nonnegative(),
    images: diyImagesSchema,
    data: diyDataSchema,
  })
  .superRefine(({ images, data }, ctx) => {
    const ids = new Set(images.map((image) => image.id));
    if (
      new Set(data.parts.map((part) => part.id)).size !== data.parts.length ||
      data.parts.some(
        (part) =>
          new Set(part.views.map((view) => view.imageId)).size !== part.views.length ||
          part.views.some((view) => !ids.has(view.imageId)),
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate parts or invalid image references' });
    }
  });
export const diyVersionSchema = z.strictObject({ version: z.number().int().nonnegative() });
export const diyRecognizeSchema = diyVersionSchema.extend({
  provider: z.string().min(1).max(60),
  partId: z.uuid().optional(),
});
export type DiyImage = z.infer<typeof diyImageSchema>;
export type DiyPart = z.infer<typeof diyPartSchema>;
export type DiyData = z.infer<typeof diyDataSchema>;
export type DiyCandidate = z.infer<typeof diyCandidateSchema>;
export type DiyImport = {
  id: string;
  images: DiyImage[];
  data: DiyData;
  version: number;
  status: string;
  warnings: string[];
  errorCode: string | null;
  leaseUntil: string | null;
  provider: string;
  model: string;
  productId: string | null;
  runId: string | null;
};
export type DiyHistoryItem = { id: string; name: string; status: string; createdAt: string };

export function emptyDiyData(): DiyData {
  return {
    name: '',
    categoryId: '',
    code: '',
    targetProductId: null,
    quantity: 1,
    hint: '',
    notes: '',
    salePrice: '',
    silverCost: { weightGrams: '0', costGramPrice: '20', quoteGramPrice: '30' },
    extraCosts: [],
    parts: [],
  };
}
export function newDiyPart(): DiyPart {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    views: [],
    warnings: [],
    candidates: [],
    kind: 'MATERIAL',
    materialId: null,
    materialBatchEntryId: null,
    cabochonId: null,
    usageUnit: 'BEAD',
    quantity: '',
    unitCost: '',
    quoteUnitPrice: null,
    reviewed: false,
    excluded: false,
  };
}

// Any financial/selection/evidence edit invalidates the previous human confirmation.
export function patchDiyPart(part: DiyPart, patch: Partial<DiyPart>): DiyPart {
  const substantive = Object.keys(patch).some(
    (key) =>
      key !== 'reviewed' &&
      key !== 'excluded' &&
      JSON.stringify(part[key as keyof DiyPart]) !== JSON.stringify(patch[key as keyof DiyPart]),
  );
  return { ...part, ...patch, reviewed: substantive ? false : (patch.reviewed ?? part.reviewed) };
}

export function diySource(data: DiyData, requireReviewed = true) {
  const parts = data.parts.filter((part) => !part.excluded);
  if (!parts.length || (requireReviewed && parts.some((part) => !part.reviewed))) return null;
  if (parts.some((part) => !part.name.trim() || (part.kind === 'MATERIAL' && !part.materialId)))
    return null;
  const result = productDiySchema.safeParse({
    origin: 'DIY',
    quantity: data.quantity,
    notes: data.notes,
    silverCost: data.silverCost,
    materials: parts
      .filter((part) => part.kind === 'MATERIAL')
      .map((part) => ({
        materialBatchEntryId: part.materialBatchEntryId,
        usageUnit: part.usageUnit,
        quantity: part.quantity,
        unitCost: part.unitCost,
        quoteUnitPrice: part.quoteUnitPrice || null,
      })),
    cabochons: parts
      .filter((part) => part.kind === 'CABOCHON')
      .map((part) => ({
        productId: part.cabochonId,
        quantity: Number(part.quantity),
        unitCost: part.unitCost,
        quoteUnitPrice: part.quoteUnitPrice || null,
      })),
    extraCosts: data.extraCosts.map((cost) => ({ ...cost, quoteAmount: cost.quoteAmount || null })),
    craftDesignFee: { unitAmount: '0', accumulateByQuantity: false, totalAmount: null },
  });
  return result.success ? result.data : null;
}

// A targeted run replaces only its unconfirmed part; a full run never overwrites reviewed work.
export function mergeDiyRecognition(previous: DiyPart[], incoming: DiyPart[], partId?: string) {
  if (partId)
    return previous.map((part) =>
      part.id === partId && !part.reviewed ? { ...incoming[0], id: part.id } : part,
    );
  const kept = previous.filter((part) => part.reviewed || part.excluded);
  return [
    ...kept,
    ...incoming.filter(
      (part) =>
        !kept.some((old) =>
          part.views.some((view) =>
            old.views.some((other) => {
              if (view.imageId !== other.imageId) return false;
              const a = view.box;
              const b = other.box;
              const overlap =
                Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
                Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
              return overlap / Math.min(a.width * a.height, b.width * b.height) > 0.6;
            }),
          ),
        ),
    ),
  ];
}
