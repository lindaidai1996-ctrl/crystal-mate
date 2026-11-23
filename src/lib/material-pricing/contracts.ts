import { z } from 'zod';

export const pricingAmount = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
export const pricingRate = z.string().regex(/^\d{1,2}(?:\.\d{1,2})?$/);
export const pricingRules = ['PERCENT', 'FIXED', 'CUSTOM', 'MARGIN'] as const;
export const pricingGroupSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    materialIds: z
      .array(z.string().cuid())
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
    lossRate: pricingRate.default('0'),
    marketLinked: z.boolean().default(true),
    marketCoefficient: z
      .string()
      .regex(/^\d{1,4}(?:\.\d{1,4})?$/)
      .default('1'),
    pricingRule: z.enum(pricingRules).default('CUSTOM'),
    pricingValue: pricingAmount.nullable().default(null),
    enabled: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.pricingRule !== 'MARGIN' ||
      value.pricingValue === null ||
      Number(value.pricingValue) < 100,
    {
      path: ['pricingValue'],
      message: 'Margin must be below 100%',
    },
  );
export const pricingGroupUpdateSchema = pricingGroupSchema.safeExtend({
  version: z.number().int().positive(),
});
export const pricingPublishSchema = z.strictObject({
  version: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  saleGramPrice: pricingAmount,
});
export const pricingLineSchema = z.strictObject({
  id: z.string().cuid().optional(),
  groupId: z.string().cuid(),
  publicationId: z.string().cuid(),
  costBasisToken: z.string().min(1).max(3000),
  quantity: pricingAmount.refine((value) => Number(value) > 0),
  unitCost: pricingAmount,
  quoteUnitPrice: pricingAmount,
});
export type PricingLineInput = z.infer<typeof pricingLineSchema>;
export type PricingGroupInput = z.infer<typeof pricingGroupSchema>;
export type PricingPurchase = {
  id: string;
  materialId: string;
  materialName: string;
  batchId: string;
  batchName: string;
  distributorId: string;
  distributorName: string;
  receivedAt: string;
  amount: string | null;
  weight: string | null;
};
export type PricingTotals = {
  amount: string;
  weight: string;
  rawCost: string | null;
  adjustedCost: string | null;
  count: number;
};
export type PricingCostBasis = {
  groupId: string;
  publicationId: string;
  name: string;
  rawCost: string;
  adjustedCost: string;
  lossRate: string;
  capturedAt: string;
};
export type PricingPublication = {
  id: string;
  version: number;
  saleGramPrice: string;
  createdAt: string;
  fingerprint: string;
  costBasis: Omit<PricingPreview, 'purchases' | 'excluded'> & {
    excluded: { id: string; reason: PricingSummary['excluded'][number]['reason'] }[];
  };
};
export type PricingGroup = Omit<PricingGroupInput, 'materialIds'> & {
  id: string;
  version: number;
  materials: { id: string; name: string; unit: string }[];
  publication: PricingPublication | null;
};
export type PricingSummary = {
  totals: PricingTotals;
  recent: PricingTotals;
  latest: PricingPurchase | null;
  distributors: (PricingTotals & { id: string; name: string })[];
  excluded: (PricingPurchase & { reason: 'MISSING_AMOUNT' | 'INVALID_WEIGHT' | 'FUTURE_DATE' })[];
  purchases: PricingPurchase[];
};
export type PricingPreview = PricingSummary & {
  fingerprint: string;
  lossRate: string;
  pricingRule: PricingGroupInput['pricingRule'];
  pricingValue: string | null;
  marketLinked: boolean;
  marketCoefficient: string;
  market: { price: string; updatedAt: string; purchaseAverage: string } | null;
  replacementCost: string | null;
  adjustedReplacementCost: string | null;
  pricingCost: string | null;
  suggestedPrice: string | null;
  warning: 'MARKET_UNAVAILABLE' | 'NO_RECENT_SAMPLES' | 'INVALID_REPLACEMENT' | null;
  changed: boolean;
};
export type PricingOption = {
  id: string;
  name: string;
  publicationId: string;
  saleGramPrice: string;
  unitCost: string;
  rawCost: string;
  lossRate: string;
  costBasisToken: string;
};
