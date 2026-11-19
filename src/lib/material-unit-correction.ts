import { z } from 'zod';
import type { MaterialUnit } from './client-types';

export const unitCorrectionPreviewSchema = z
  .object({
    unit: z.enum(['STRAND', 'BEAD', 'GRAM']),
  })
  .strict();
export const unitCorrectionSchema = unitCorrectionPreviewSchema
  .extend({
    snapshot: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict();

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
    changes: UnitCorrectionChange[];
    issues: string[];
    diy: { id: string; productId: string; name: string; unit: MaterialUnit; conflict: boolean }[];
  }[];
};
