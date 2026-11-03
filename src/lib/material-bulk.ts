import { z } from 'zod';
import type { Material, MaterialValues } from './client-types';
import { MAX_STOCK, validMaterialQuantity } from './inventory';
import { recalculateMaterial } from './material-calculations';

export const bulkUnits = ['STRAND', 'BEAD', 'GRAM'] as const;
const id = z.string().cuid();
const amount = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
const pricePatch = z.strictObject({
  saleUnitPrice: amount.optional(),
  saleGramPrice: amount.optional(),
  saleChildUnitPrice: amount.optional(),
});
const unitPrices = z.strictObject({
  STRAND: pricePatch.optional(),
  BEAD: pricePatch.omit({ saleChildUnitPrice: true }).optional(),
  GRAM: z.strictObject({ saleGramPrice: amount.optional() }).optional(),
});
export const bulkSaleSchema = z.discriminatedUnion('rule', [
  z.strictObject({
    rule: z.enum(['COST', 'PERCENT_30', 'PERCENT_50', 'PERCENT_60']),
  }),
  z.strictObject({ rule: z.enum(['FIXED_AMOUNT', 'CUSTOM_PERCENT']), value: amount }),
  z.strictObject({ rule: z.literal('CUSTOM_AMOUNT'), prices: unitPrices }),
]);
export const bulkStockSchema = z.strictObject({
  mode: z.enum(['SET', 'ADD', 'SUBTRACT']),
  quantities: z.strictObject({
    STRAND: z.number().int().min(0).max(MAX_STOCK).optional(),
    BEAD: z.number().int().min(0).max(MAX_STOCK).optional(),
    GRAM: z
      .number()
      .min(0)
      .max(MAX_STOCK)
      .refine((v) => validMaterialQuantity(v, 'GRAM'))
      .optional(),
  }),
  reason: z.string().trim().max(500).default(''),
});
export const materialBulkPreviewSchema = z.strictObject({ materialIds: z.array(id).min(1) });
const version = z.strictObject({ id, updatedAt: z.iso.datetime() });
export const materialBulkSnapshotSchema = z.strictObject({
  materials: z.array(version).min(1),
  entries: z.array(version),
});
export const materialBulkDeleteSchema = z.strictObject({ snapshot: materialBulkSnapshotSchema });
export const materialBulkUpdateSchema = z.strictObject({
  snapshot: materialBulkSnapshotSchema,
  entryIds: z.array(id),
  changes: z
    .strictObject({
      categoryId: id.optional(),
      batchId: id.optional(),
      distributorId: id.optional(),
      stock: bulkStockSchema.optional(),
      sale: bulkSaleSchema.optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0),
});

export type MaterialBulkUpdate = z.infer<typeof materialBulkUpdateSchema>;
export type MaterialBulkSnapshot = z.infer<typeof materialBulkSnapshotSchema>;
export type BulkSale = z.infer<typeof bulkSaleSchema>;
export type BulkStock = z.infer<typeof bulkStockSchema>;
export type BulkIssue = { materialId: string; name: string; entryId?: string; code: string };
export type MaterialBulkPreview = {
  items: Material[];
  snapshot: MaterialBulkSnapshot;
  deleteBlockers: BulkIssue[];
};

export function bulkStockQuantity(
  current: number | null,
  unit: MaterialValues['unit'],
  stock: BulkStock,
) {
  const quantity = stock.quantities[unit];
  if (quantity === undefined || !validMaterialQuantity(quantity, unit))
    throw new Error('QUANTITY_REQUIRED');
  if (stock.mode !== 'SET' && current === null) throw new Error('UNKNOWN_STOCK');
  const next =
    stock.mode === 'SET'
      ? quantity
      : Math.round((current! + (stock.mode === 'ADD' ? quantity : -quantity)) * 100) / 100;
  if (!validMaterialQuantity(next, unit)) throw new Error('STOCK_OUT_OF_RANGE');
  return next;
}

export function bulkSaleValues(current: MaterialValues, sale: BulkSale) {
  let values: MaterialValues;
  if (sale.rule === 'CUSTOM_AMOUNT') {
    const prices = sale.prices[current.unit];
    if (!prices || !Object.values(prices).some((value) => value !== undefined))
      throw new Error('PRICE_REQUIRED');
    values = recalculateMaterial({
      ...current,
      ...prices,
      saleRule: sale.rule,
      saleRuleValue: null,
    });
  } else {
    values = recalculateMaterial(
      {
        ...current,
        saleRule: sale.rule,
        saleRuleValue: 'value' in sale ? sale.value : null,
      },
      true,
    );
  }
  const fields = [
    'saleUnitPrice',
    'saleGramPrice',
    'saleChildUnitPrice',
    'saleUnitManual',
    'saleGramManual',
    'saleChildManual',
    'saleRule',
    'saleRuleValue',
  ] as const;
  for (const field of ['saleUnitPrice', 'saleGramPrice', 'saleChildUnitPrice'] as const) {
    if (values[field] !== null && !/^\d{1,10}(?:\.\d{1,2})?$/.test(values[field]!))
      throw new Error('PRICE_OUT_OF_RANGE');
  }
  return Object.fromEntries(fields.map((field) => [field, values[field]])) as Pick<
    MaterialValues,
    (typeof fields)[number]
  >;
}

export function togglePageSelection(
  selected: readonly string[],
  pageIds: readonly string[],
  checked: boolean,
) {
  const keys = new Set(selected);
  for (const key of pageIds) {
    if (checked) keys.add(key);
    else keys.delete(key);
  }
  return [...keys];
}
