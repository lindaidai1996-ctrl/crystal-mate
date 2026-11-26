import { schemePricesWriteSchema } from './price-schemes/contracts';
import { z } from 'zod';
import { productDiySchema, productSourceSchema, validateProductPricing } from './validation';
import { productSaleRules } from './product-pricing';

const priceCents = z.number().int().min(0).max(2147483647);

const manualPriceChangeSchema = z.strictObject({
  priceCents,
  expectedPriceCents: priceCents,
  schemePrices: schemePricesWriteSchema.optional(),
});

export const sourcePricingSnapshotSchema = z.strictObject({
  saleRule: z.enum(productSaleRules),
  saleRuleValue: z
    .string()
    .regex(/^-?\d{1,10}(?:\.\d{1,2})?$/)
    .nullable(),
  saleManual: z.boolean(),
});

export const sourceRulePriceChangeSchema = sourcePricingSnapshotSchema
  .extend({
    priceCents,
    expectedPriceCents: priceCents,
    schemePrices: schemePricesWriteSchema.optional(),
    expectedPricing: sourcePricingSnapshotSchema,
  })
  .superRefine(validateProductPricing);

export const sourcePriceChangeSchema = z.union([
  manualPriceChangeSchema,
  sourceRulePriceChangeSchema,
]);

export type SourcePriceChange = z.infer<typeof sourcePriceChangeSchema>;

// Existing source-only clients keep their payload and never change the sale price.
export const productSourceWriteSchema = z.union([
  z.strictObject({ source: productDiySchema, pricing: sourcePriceChangeSchema }),
  productSourceSchema.transform((source) => ({
    source,
    pricing: undefined as SourcePriceChange | undefined,
  })),
]);
