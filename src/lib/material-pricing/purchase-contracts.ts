import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/index-browser.js';

export const procurementAmount = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
export const procurementLineSchema = z.strictObject({
  entryId: z.string().cuid().optional(),
  materialId: z.string().cuid(),
  weight: procurementAmount.refine(
    (value) => new Decimal(value).gt(0) && new Decimal(value).lte('2147483647'),
  ),
  quote: procurementAmount.nullable(),
  amount: procurementAmount,
  quotePurpose: z.enum(['LEGACY', 'BEFORE_DISCOUNT']).default('BEFORE_DISCOUNT'),
});
export const procurementSchema = z.strictObject({
  receivedAt: z.iso.date(),
  distributorId: z.string().cuid(),
  initialStock: z.enum(['FULL', 'UNKNOWN']).default('FULL'),
  notes: z.string().trim().max(10000).default(''),
  lines: z
    .array(procurementLineSchema)
    .min(1)
    .max(20)
    .refine((lines) => new Set(lines.map((line) => line.materialId)).size === lines.length),
});
export const procurementUpdateSchema = procurementSchema.extend({
  fingerprint: z.string().length(64),
});
export type ProcurementInput = z.infer<typeof procurementSchema>;
export type ProcurementLine = z.infer<typeof procurementLineSchema>;
export type ProcurementRow = {
  id: string;
  batchId: string;
  batchName: string;
  receivedAt: string;
  distributorId: string;
  distributorName: string;
  materialId: string;
  materialName: string;
  groupId: string;
  groupName: string;
  weight: string | null;
  amount: string | null;
  quote: string | null;
  quotePurpose: string;
  actualPrice: string | null;
  discount: string | null;
  remaining: string | null;
};
export function procurementMetrics(
  weight: string | null,
  amount: string | null,
  quote: string | null,
) {
  if (weight === null || amount === null || !new Decimal(weight).gt(0))
    return { actualPrice: null, discount: null };
  const paid = new Decimal(amount);
  return {
    actualPrice: paid.div(weight).toFixed(4),
    discount:
      quote !== null && new Decimal(quote).gt(0)
        ? paid.div(new Decimal(weight).mul(quote)).mul(10).toFixed(2)
        : null,
  };
}
export function amountFromDiscount(weight: string, quote: string, discount: string) {
  if (![weight, quote, discount].every((value) => /^\d{1,10}(?:\.\d{1,8})?$/.test(value)))
    return null;
  const result = new Decimal(weight).mul(quote).mul(discount).div(10);
  return result.lte('9999999999.99') ? result.toFixed(2) : null;
}
export function summarizeProcurement(rows: ProcurementRow[], by: 'month' | 'distributor') {
  const buckets = new Map<
    string,
    {
      key: string;
      name: string;
      count: number;
      weight: Decimal;
      amount: Decimal;
      unknownAmount: number;
      unknownWeight: number;
    }
  >();
  for (const row of rows) {
    const key = by === 'month' ? row.receivedAt.slice(0, 7) : row.distributorId;
    const bucket = buckets.get(key) ?? {
      key,
      name: by === 'month' ? key : row.distributorName,
      count: 0,
      weight: new Decimal(0),
      amount: new Decimal(0),
      unknownAmount: 0,
      unknownWeight: 0,
    };
    bucket.count++;
    if (row.weight === null) bucket.unknownWeight++;
    else bucket.weight = bucket.weight.plus(row.weight);
    if (row.amount === null) bucket.unknownAmount++;
    else bucket.amount = bucket.amount.plus(row.amount);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((row) => ({
    ...row,
    weight: row.weight.toFixed(2),
    amount: row.amount.toFixed(2),
  }));
}
