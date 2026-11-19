import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './api';
import type { MaterialUnit } from './client-types';
import type { UnitCorrectionChange, UnitCorrectionPreview } from './material-unit-correction';
import { validMaterialQuantity } from './inventory';

const include = {
  batchEntries: {
    orderBy: { id: 'asc' },
    include: {
      batch: true,
      distributor: true,
      stockAdjustments: { orderBy: { id: 'asc' } },
      diyLines: {
        orderBy: { id: 'asc' },
        include: { run: { include: { product: { select: { id: true, name: true } } } } },
      },
    },
  },
} satisfies Prisma.MaterialInclude;
type Item = Prisma.MaterialGetPayload<{ include: typeof include }>;
type Entry = Item['batchEntries'][number];
type Pricing = Pick<
  Item,
  | 'unit'
  | 'purchaseUnitPrice'
  | 'purchaseGramPrice'
  | 'saleUnitPrice'
  | 'saleGramPrice'
  | 'baseSaleUnitPrice'
  | 'baseSaleGramPrice'
  | 'saleUnitManual'
  | 'saleGramManual'
>;

const childReset = {
  childCount: null,
  childWeightGrams: null,
  childUnitPrice: null,
  childPriceSource: null,
  baseSaleChildUnitPrice: null,
  saleChildUnitPrice: null,
  saleChildManual: false,
} as const;

// This corrects labels and their dependent fields, never converts a quantity.
function pricingPatch(item: Pricing, to: MaterialUnit) {
  return {
    ...(to !== 'STRAND' ? childReset : {}),
    ...(to === 'GRAM'
      ? {
          weightGrams: new Prisma.Decimal(1),
          purchaseUnitPrice: item.purchaseUnitPrice,
          purchaseGramPrice: item.purchaseUnitPrice,
          purchaseGramManual: true,
          baseSaleGramPrice: item.baseSaleUnitPrice,
          saleGramPrice: item.saleUnitPrice,
          saleGramManual: item.saleUnitManual,
        }
      : item.unit === 'GRAM'
        ? {
            weightGrams: null,
            purchaseUnitPrice: item.purchaseGramPrice,
            purchaseGramPrice: null,
            purchaseGramManual: false,
            baseSaleUnitPrice: item.baseSaleGramPrice,
            baseSaleGramPrice: null,
            saleUnitPrice: item.saleGramPrice,
            saleGramPrice: null,
            saleUnitManual: item.saleGramManual,
            saleGramManual: false,
          }
        : {}),
  };
}

function entryPlan(entry: Entry, from: MaterialUnit, to: MaterialUnit) {
  const patch: Prisma.MaterialBatchEntryUpdateInput = {
    ...pricingPatch({ ...entry, unit: from }, to),
    // Old input drafts must not restore prices/weights under the wrong unit.
    purchaseUnitInputs: Prisma.DbNull,
  };
  const issues: string[] = [];
  const quantities = [
    entry.receivedQty,
    entry.remainingQty,
    ...entry.stockAdjustments.flatMap((row) => [row.beforeQty, row.afterQty]),
  ];
  if (quantities.some((value) => value !== null && !validMaterialQuantity(value.toNumber(), to)))
    issues.push('QUANTITY');
  if (to === 'GRAM') {
    const quantity = entry.receivedQty;
    const price = entry.purchaseUnitPrice;
    const total =
      entry.purchaseTotalAmount ??
      (quantity && price ? quantity.mul(price).toDecimalPlaces(2) : null);
    if (
      !quantity ||
      quantity.lte(0) ||
      !price ||
      !total ||
      total.gt('9999999999.99') ||
      !total.div(quantity).toDecimalPlaces(2).equals(price)
    )
      issues.push('GRAM_PURCHASE');
    Object.assign(patch, {
      purchaseInputMode: 'BATCH',
      purchaseTotalWeightGrams: quantity,
      purchaseTotalAmount: total,
      purchaseQuotedGramPrice: price,
      purchaseAutoField: null,
      sampleWeightGrams: null,
      manualPurchaseUnitPrice: null,
      unitPriceSource: 'AVERAGE',
    });
  } else if (from === 'GRAM') {
    Object.assign(patch, {
      purchaseInputMode: 'BATCH',
      purchaseTotalWeightGrams: null,
      purchaseQuotedGramPrice: null,
      purchaseAutoField: null,
      sampleWeightGrams: null,
      manualPurchaseUnitPrice: entry.purchaseGramPrice,
      unitPriceSource: entry.purchaseGramPrice === null ? 'UNKNOWN' : 'MANUAL',
    });
  }
  return { patch, issues };
}

function scalar(value: unknown): string | number | boolean | null {
  if (value == null || value === Prisma.DbNull) return null;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return JSON.stringify(value);
}
function changes(before: object, patch: object): UnitCorrectionChange[] {
  return Object.entries(patch).flatMap(([field, value]) => {
    const previous = scalar(Reflect.get(before, field));
    const after = scalar(value);
    return previous === after ? [] : [{ field, before: previous, after }];
  });
}
function previewOf(item: Item, to: MaterialUnit): UnitCorrectionPreview {
  if (item.unit === to) throw new ApiError(400, 'INVALID_INPUT');
  return {
    name: item.name,
    from: item.unit,
    to,
    snapshot: createHash('sha256').update(JSON.stringify({ item, to })).digest('hex'),
    masterChanges: changes(item, pricingPatch(item, to)),
    entries: item.batchEntries.map((entry) => {
      const plan = entryPlan(entry, item.unit, to);
      return {
        id: entry.id,
        batch: entry.batch.name,
        distributor: entry.distributor.name,
        receivedQty: entry.receivedQty?.toFixed(2) ?? null,
        remainingQty: entry.remainingQty?.toFixed(2) ?? null,
        purchaseUnitPrice: entry.purchaseUnitPrice?.toFixed(2) ?? null,
        saleUnitPrice: entry.saleUnitPrice?.toFixed(2) ?? null,
        adjustmentCount: entry.stockAdjustments.length,
        changes: changes(entry, plan.patch),
        issues: plan.issues,
        diy: entry.diyLines.map((line) => ({
          id: line.id,
          productId: line.run.product.id,
          name: line.run.product.name,
          unit: line.usageUnit,
          conflict:
            to === 'GRAM'
              ? line.usageUnit !== 'GRAM'
              : to === 'BEAD' && line.usageUnit === 'STRAND',
        })),
      };
    }),
  };
}

export async function previewUnitCorrection(id: string, to: MaterialUnit) {
  return db.$transaction(
    async (tx) => {
      const item = await tx.material.findUnique({ where: { id }, include });
      if (!item) throw new ApiError(404, 'NOT_FOUND');
      return previewOf(item, to);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function correctMaterialUnit(id: string, to: MaterialUnit, snapshot: string) {
  try {
    return await db.$transaction(
      async (tx) => {
        const item = await tx.material.findUnique({ where: { id }, include });
        if (!item) throw new ApiError(404, 'NOT_FOUND');
        if (item.unit === to) throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
        const preview = previewOf(item, to);
        if (preview.snapshot !== snapshot) throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
        if (
          preview.entries.some(
            (entry) => entry.issues.length || entry.diy.some((line) => line.conflict),
          )
        )
          throw new ApiError(409, 'MATERIAL_UNIT_CONFLICT');
        for (const entry of item.batchEntries) {
          await tx.materialBatchEntry.update({
            where: { id: entry.id },
            data: entryPlan(entry, item.unit, to).patch,
          });
        }
        await tx.material.update({ where: { id }, data: { ...pricingPatch(item, to), unit: to } });
        return { unit: to };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
    throw error;
  }
}
