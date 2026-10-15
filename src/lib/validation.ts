import { z } from 'zod';
import { amountToCents, calculateCostTotal } from './cabochon-cost';
import { productSaleRules } from './product-pricing';
import { calculatePurchase, emptyPurchase } from './material-purchase';
import { calculateDiyCost } from './product-diy-cost';

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]+$/)
    .max(20)
    .optional(),
});

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

const imageAttachmentSchema = z.strictObject({
  objectKey: z.string().regex(/^images\/[0-9a-f-]+\.(?:jpg|png|webp)$/),
  fileName: z.string().trim().min(1).max(255),
  notes: z.string().trim().max(1000),
});

export const distributorSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  area: z.string().trim().min(1).max(60),
  address: z.string().trim().max(300),
  wechat: z.string().trim().max(100),
  phone: z.string().trim().max(50),
  notes: z.string().trim().max(10000),
  attachments: z.array(imageAttachmentSchema).max(12).optional(),
});

export const distributorAreaSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
});

export const marketingSchema = z.object({
  videoShot: z.boolean(),
  xiaohongshuVideoPublished: z.boolean(),
  xiaohongshuListed: z.boolean(),
  douyinVideoPublished: z.boolean(),
  douyinListed: z.boolean(),
});

export const marketingToggleSchema = z.strictObject({
  field: z.enum(['videoShot', 'xiaohongshuVideoPublished', 'xiaohongshuListed']),
  value: z.boolean(),
});

const millimetersSchema = z
  .number()
  .positive()
  .max(99999999.99)
  .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)));

export const measurementSchema = z.object({
  lengthMm: millimetersSchema.nullable().optional(),
  widthMm: millimetersSchema.nullable().optional(),
  heightMm: millimetersSchema.nullable().optional(),
});

const costAmount = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);

export const cabochonCostSchema = z
  .strictObject({
    roughStoneCost: costAmount.nullable(),
    settingCost: costAmount.nullable(),
    otherCosts: z
      .array(z.strictObject({ name: z.string().trim().min(1).max(60), amount: costAmount }))
      .max(50),
    totalCost: costAmount,
    totalManual: z.boolean(),
  })
  .superRefine((cost, context) => {
    const names = cost.otherCosts.map((item) => item.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', path: ['otherCosts'], message: 'Duplicate cost names' });
    }
    if (!cost.totalManual) {
      const total = calculateCostTotal(cost);
      if (total === null || amountToCents(total) === null) {
        context.addIssue({ code: 'custom', path: ['totalCost'], message: 'Invalid total cost' });
      }
    }
  });

const baseProductSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(10000),
  categoryId: z.string().cuid(),
  priceCents: z.number().int().min(0).max(2147483647),
  saleRule: z.enum(productSaleRules).optional(),
  saleRuleValue: z
    .string()
    .regex(/^-?\d{1,10}(?:\.\d{1,2})?$/)
    .nullable()
    .optional(),
  saleManual: z.boolean().optional(),
  currency: z.literal('CNY'),
  stock: z.number().int().min(0).max(2147483647),
  published: z.boolean(),
  imageKeys: z
    .array(z.string().min(1))
    .max(12)
    .refine((keys) => new Set(keys).size === keys.length),
  tagIds: z
    .array(z.string().cuid())
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  marketing: marketingSchema.optional(),
  measurement: measurementSchema.nullable().optional(),
  cost: cabochonCostSchema.nullable().optional(),
});

export const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().optional(),
  excludeCategoryName: z.literal('蛋面').optional(),
  tagId: z.string().cuid().optional(),
  published: z.enum(['true', 'false']).optional(),
  stock: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const materialDecimal = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
const nullableAmount = materialDecimal.nullable();
const positiveAmount = nullableAmount.refine((value) => value === null || Number(value) > 0);

export const materialCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  parentId: z.string().cuid().nullable(),
  aliases: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .refine(
      (items) => new Set(items.map((item) => item.toLocaleLowerCase())).size === items.length,
    ),
});

export const materialSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    categoryId: z.string().cuid(),
    unit: z.enum(['STRAND', 'BEAD']),
    purchaseUnitPrice: nullableAmount,
    weightGrams: positiveAmount,
    purchaseGramPrice: nullableAmount,
    purchaseGramManual: z.boolean(),
    lengthMm: positiveAmount,
    widthMm: positiveAmount,
    heightMm: positiveAmount,
    childCount: z.number().int().positive().max(2147483647).nullable(),
    childWeightGrams: positiveAmount,
    childUnitPrice: nullableAmount,
    childPriceSource: z.enum(['COUNT', 'WEIGHT', 'CUSTOM']).nullable(),
    saleRule: z.enum([
      'COST',
      'PERCENT_10',
      'PERCENT_20',
      'PERCENT_30',
      'PERCENT_50',
      'FIXED_AMOUNT',
      'CUSTOM_PERCENT',
    ]),
    saleRuleValue: nullableAmount,
    saleUnitPrice: nullableAmount,
    saleGramPrice: nullableAmount,
    saleChildUnitPrice: nullableAmount,
    saleUnitManual: z.boolean(),
    saleGramManual: z.boolean(),
    saleChildManual: z.boolean(),
    notes: z.string().trim().max(10000),
    imageKeys: z
      .array(z.string().min(1))
      .max(12)
      .refine((keys) => new Set(keys).size === keys.length),
  })
  .superRefine((data, context) => {
    if (
      (data.saleRule === 'FIXED_AMOUNT' || data.saleRule === 'CUSTOM_PERCENT') !==
      (data.saleRuleValue !== null)
    ) {
      context.addIssue({ code: 'custom', path: ['saleRuleValue'], message: 'Invalid rule value' });
    }
    if (
      data.unit === 'BEAD' &&
      (data.childCount !== null ||
        data.childWeightGrams !== null ||
        data.childUnitPrice !== null ||
        data.childPriceSource !== null ||
        data.saleChildUnitPrice !== null ||
        data.saleChildManual)
    ) {
      context.addIssue({ code: 'custom', path: ['unit'], message: 'Beads cannot have child data' });
    }
  });

export const materialListSchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const materialMasterSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().cuid(),
  tagIds: z
    .array(z.string().cuid())
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  unit: z.enum(['STRAND', 'BEAD']),
  notes: z.string().trim().max(10000),
});

const batchHeaderSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  receivedAt: z.iso.date(),
  notes: z.string().trim().max(10000),
});

export const materialBatchHeaderSchema = batchHeaderSchema;
export const materialBatchWriteSchema = batchHeaderSchema.extend({
  attachments: z.array(imageAttachmentSchema).max(12).default([]),
});
export const materialBatchSelectionSchema = z.union([
  z.strictObject({ batchId: z.string().cuid() }),
  z.strictObject({ newBatch: batchHeaderSchema }),
]);

const positiveDiyAmount = costAmount.refine((value) => amountToCents(value)! > BigInt(0));
const quantity = z.number().int().positive().max(2147483647);

export const productPurchaseSchema = z.strictObject({
  origin: z.literal('PURCHASED'),
  selection: materialBatchSelectionSchema,
  distributorId: z.string().cuid(),
  quantity,
  unitCost: costAmount,
  notes: z.string().trim().max(10000).default(''),
});

export const productDiySchema = z
  .strictObject({
    origin: z.literal('DIY'),
    quantity,
    notes: z.string().trim().max(10000).default(''),
    materials: z
      .array(
        z.strictObject({
          materialBatchEntryId: z.string().cuid(),
          usageUnit: z.enum(['STRAND', 'BEAD', 'GRAM']),
          quantity: positiveDiyAmount,
          unitCost: costAmount,
          quoteUnitPrice: costAmount.nullable().optional(),
        }),
      )
      .max(50),
    cabochons: z
      .array(
        z.strictObject({
          productId: z.string().cuid(),
          quantity,
          unitCost: costAmount,
          quoteUnitPrice: costAmount.nullable().optional(),
        }),
      )
      .max(50),
    extraCosts: z
      .array(
        z.strictObject({
          name: z.string().trim().min(1).max(60),
          amount: costAmount,
          quoteAmount: costAmount.nullable().optional(),
        }),
      )
      .max(50),
    craftDesignFee: z
      .strictObject({
        unitAmount: costAmount,
        accumulateByQuantity: z.boolean(),
        totalAmount: z
          .string()
          .regex(/^\d{1,20}(?:\.\d{1,2})?$/)
          .nullable(),
      })
      .optional(),
  })
  .superRefine((input, context) => {
    const cost = calculateDiyCost(input);
    if (cost && amountToCents(cost.perUnitCost) === null)
      context.addIssue({
        code: 'custom',
        path: ['craftDesignFee'],
        message: 'Cost per item exceeds the supported amount',
      });
    input.materials.forEach((line, index) => {
      if (line.usageUnit !== 'GRAM' && !Number.isInteger(Number(line.quantity)))
        context.addIssue({
          code: 'custom',
          path: ['materials', index, 'quantity'],
          message: 'Whole units required',
        });
    });
  });

export const productSourceSchema = z.discriminatedUnion('origin', [
  productPurchaseSchema,
  productDiySchema,
]);

export const productSchema = baseProductSchema
  .extend({ source: productSourceSchema.optional() })
  .superRefine((input, context) => {
    const hasPricing =
      input.saleRule !== undefined ||
      input.saleRuleValue !== undefined ||
      input.saleManual !== undefined;
    if (input.saleRule !== 'FIXED_AMOUNT' && input.saleRuleValue?.startsWith('-'))
      context.addIssue({
        code: 'custom',
        path: ['saleRuleValue'],
        message: 'Negative values require fixed amount pricing',
      });
    if (
      hasPricing &&
      (input.saleRule === undefined ||
        input.saleRuleValue === undefined ||
        input.saleManual === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['saleRule'],
        message: 'Complete pricing fields required',
      });
    }
    if (
      input.saleManual === false &&
      (input.saleRule === 'FIXED_AMOUNT' || input.saleRule === 'CUSTOM_PERCENT') &&
      input.saleRuleValue == null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['saleRuleValue'],
        message: 'Pricing parameter required',
      });
    }
  });

export const productStockAdjustmentSchema = z.strictObject({
  delta: z
    .number()
    .int()
    .min(-2147483647)
    .max(2147483647)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
});

export const materialPurchaseSchema = z
  .strictObject({
    mode: z.enum(['UNIT', 'BATCH']).default('UNIT'),
    quotedGramPrice: nullableAmount.default(null),
    totalWeightGrams: positiveAmount.default(null),
    totalAmount: nullableAmount.default(null),
    autoField: z
      .enum(['quotedGramPrice', 'totalWeightGrams', 'totalAmount'])
      .nullable()
      .default(null),
    sampleWeightGrams: positiveAmount.default(null),
    manualUnitPrice: nullableAmount.default(null),
    unitInputs: z
      .strictObject({
        price: nullableAmount,
        weight: positiveAmount,
        gramPrice: nullableAmount,
        gramManual: z.boolean(),
      })
      .nullable()
      .default(null),
  })
  .default(emptyPurchase());

function validateMaterialPurchase(
  data: {
    values: z.infer<typeof materialSchema>;
    purchase: z.infer<typeof materialPurchaseSchema>;
    receivedQty: number | null;
  },
  context: z.RefinementCtx,
) {
  if (data.purchase.mode === 'UNIT' && data.receivedQty === null) {
    context.addIssue({
      code: 'custom',
      path: ['receivedQty'],
      message: 'Unit mode requires a quantity',
    });
  }
  if (
    data.purchase.mode === 'BATCH' &&
    !calculatePurchase(data.values, data.purchase, data.receivedQty).valid
  ) {
    context.addIssue({
      code: 'custom',
      path: ['purchase'],
      message: 'Enter valid batch weight and amount, or two values to calculate them',
    });
  }
}

const materialCreateObject = z.strictObject({
  values: materialSchema,
  tagIds: z
    .array(z.string().cuid())
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
  selection: materialBatchSelectionSchema,
  distributorId: z.string().cuid(),
  receivedQty: z.number().int().positive().max(2147483647).nullable(),
  purchase: materialPurchaseSchema,
});

export const materialCreateSchema = materialCreateObject.superRefine(validateMaterialPurchase);
export const materialBatchEntrySchema = materialCreateObject
  .omit({ tagIds: true })
  .superRefine(validateMaterialPurchase);
export const materialBatchEntryUpdateSchema = z
  .strictObject({
    values: materialSchema,
    tagIds: materialMasterSchema.shape.tagIds,
    distributorId: z.string().cuid(),
    receivedQty: z.number().int().positive().max(2147483647).nullable(),
    purchase: materialPurchaseSchema,
  })
  .superRefine(validateMaterialPurchase);
