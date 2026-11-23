import { z } from 'zod';
import type { MaterialUnit } from './client-types';

const amount = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
  .nullable();
const pricingSchema = z
  .object({
    purchaseUnitPrice: amount,
    saleUnitPrice: amount,
    baseSaleUnitPrice: amount,
    weightGrams: amount,
    purchaseGramPrice: amount,
    saleGramPrice: amount,
    baseSaleGramPrice: amount,
  })
  .strict();
export const unitCorrectionEditsSchema = z
  .object({
    master: pricingSchema,
    entries: z
      .array(
        pricingSchema
          .extend({
            id: z.string().min(1).max(100),
            receivedQty: amount,
            remainingQty: amount,
            purchaseTotalAmount: amount,
            purchaseTotalWeightGrams: amount,
            adjustments: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(100),
                    beforeQty: amount,
                    afterQty: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/),
                  })
                  .strict(),
              )
              .max(5000),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export const unitCorrectionPreviewSchema = z
  .object({
    unit: z.enum(['STRAND', 'BEAD', 'GRAM']),
    edits: unitCorrectionEditsSchema.optional(),
  })
  .strict();
export const unitCorrectionSchema = unitCorrectionPreviewSchema
  .extend({
    snapshot: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict();
export type UnitCorrectionEdits = z.infer<typeof unitCorrectionEditsSchema>;
export type UnitCorrectionPricing = UnitCorrectionEdits['master'];
export type UnitCorrectionEntry = UnitCorrectionEdits['entries'][number];
export type UnitCorrectionChange = {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};
export type UnitCorrectionPreview = {
  name: string;
  from: MaterialUnit;
  to: MaterialUnit;
  snapshot: string;
  edits: UnitCorrectionEdits;
  masterChanges: UnitCorrectionChange[];
  entries: {
    id: string;
    batch: string;
    distributor: string;
    receivedQty: string | null;
    remainingQty: string | null;
    purchaseUnitPrice: string | null;
    saleUnitPrice: string | null;
    adjustmentCount: number;
    adjustments: {
      id: string;
      createdAt: string;
      beforeQty: string | null;
      afterQty: string;
      reason: string;
    }[];
    changes: UnitCorrectionChange[];
    issues: string[];
    diy: { id: string; productId: string; name: string; unit: MaterialUnit; conflict: boolean }[];
  }[];
};
