import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { ApiError } from './api';
import type { MaterialUnit } from './client-types';
import {
  unitCorrectionEditsSchema,
  type UnitCorrectionChange,
  type UnitCorrectionEdits,
  type UnitCorrectionEntry,
  type UnitCorrectionPricing,
  type UnitCorrectionPreview,
} from './material-unit-correction';
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
type Pricing = Pick<
  Item,
  | 'purchaseUnitPrice'
  | 'purchaseGramPrice'
  | 'saleUnitPrice'
  | 'saleGramPrice'
  | 'baseSaleUnitPrice'
  | 'baseSaleGramPrice'
  | 'weightGrams'
>;
const dec = (value: string | null) => (value === null ? null : new Prisma.Decimal(value));
const text = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? null;
const maxAmount = new Prisma.Decimal('9999999999.99');
function bounded(value: Prisma.Decimal | null) {
  return value !== null && value.gte(0) && value.lte(maxAmount) ? text(value) : null;
}
function totalOf(quantity: string | null, price: string | null) {
  return quantity === null || price === null
    ? null
    : bounded(dec(quantity)!.mul(price).toDecimalPlaces(2));
}
function priceOf(total: string | null, quantity: string | null) {
  return total === null || quantity === null || dec(quantity)!.lte(0)
    ? null
    : bounded(dec(total)!.div(quantity).toDecimalPlaces(2));
}

const childReset = {
  childCount: null,
  childWeightGrams: null,
  childUnitPrice: null,
  childPriceSource: null,
  baseSaleChildUnitPrice: null,
  saleChildUnitPrice: null,
  saleChildManual: false,
} as const;

function suggestedPricing(
  item: Pricing,
  from: MaterialUnit,
  to: MaterialUnit,
): UnitCorrectionPricing {
  if (to === 'GRAM') {
    // Existing gram fields already describe the target unit. Never erase them
    // merely because the old count-based price is unknown.
    const purchase = text(item.purchaseGramPrice ?? item.purchaseUnitPrice);
    const sale = text(item.saleGramPrice ?? item.saleUnitPrice);
    const base = text(item.baseSaleGramPrice ?? item.baseSaleUnitPrice);
    return {
      purchaseUnitPrice: purchase,
      saleUnitPrice: sale,
      baseSaleUnitPrice: base,
      purchaseGramPrice: purchase,
      saleGramPrice: sale,
      baseSaleGramPrice: base,
      weightGrams: '1.00',
    };
  }
  if (from === 'GRAM') {
    return {
      purchaseUnitPrice: null,
      saleUnitPrice: null,
      baseSaleUnitPrice: null,
      purchaseGramPrice: text(item.purchaseGramPrice),
      saleGramPrice: text(item.saleGramPrice),
      baseSaleGramPrice: text(item.baseSaleGramPrice),
      weightGrams: null,
    };
  }
  return Object.fromEntries(
    Object.keys(unitCorrectionEditsSchema.shape.master.shape).map((field) => [
      field,
      text(item[field as keyof Pricing]),
    ]),
  ) as UnitCorrectionPricing;
}
function suggestions(item: Item, to: MaterialUnit): UnitCorrectionEdits {
  return {
    master: suggestedPricing(item, item.unit, to),
    entries: item.batchEntries.map((entry) => {
      const pricing = suggestedPricing(entry, item.unit, to);
      const received =
        to === 'GRAM'
          ? (text(entry.purchaseTotalWeightGrams ?? entry.receivedQty) ??
            priceOf(text(entry.purchaseTotalAmount), pricing.purchaseUnitPrice))
          : item.unit === 'GRAM'
            ? null
            : text(entry.receivedQty);
      const remaining = entry.remainingQty?.eq(0)
        ? '0.00'
        : item.unit === 'GRAM' && to !== 'GRAM'
          ? null
          : to === 'GRAM' && received !== text(entry.receivedQty)
            ? entry.remainingQty !== null &&
              entry.receivedQty !== null &&
              entry.remainingQty.eq(entry.receivedQty)
              ? received
              : null
            : text(entry.remainingQty);
      const total =
        text(entry.purchaseTotalAmount) ??
        (to === 'GRAM' && entry.purchaseInputMode === 'BATCH'
          ? totalOf(received, pricing.purchaseUnitPrice)
          : totalOf(text(entry.receivedQty), text(entry.purchaseUnitPrice)));
      if (to === 'GRAM' && pricing.purchaseUnitPrice === null) {
        pricing.purchaseUnitPrice = priceOf(total, received);
        pricing.purchaseGramPrice = pricing.purchaseUnitPrice;
      }
      return {
        ...pricing,
        id: entry.id,
        receivedQty: received,
        remainingQty: remaining,
        purchaseTotalAmount: total,
        purchaseTotalWeightGrams: to === 'GRAM' ? received : text(entry.purchaseTotalWeightGrams),
        adjustments: entry.stockAdjustments.map((row) => ({
          id: row.id,
          beforeQty: text(row.beforeQty),
          afterQty: text(row.afterQty)!,
        })),
      };
    }),
  };
}
function pricingPatch(input: UnitCorrectionPricing, to: MaterialUnit) {
  return {
    ...(to !== 'STRAND' ? childReset : {}),
    purchaseUnitPrice: dec(input.purchaseUnitPrice),
    saleUnitPrice: dec(input.saleUnitPrice),
    baseSaleUnitPrice: dec(input.baseSaleUnitPrice),
    weightGrams: to === 'GRAM' ? new Prisma.Decimal(1) : dec(input.weightGrams),
    purchaseGramPrice: dec(to === 'GRAM' ? input.purchaseUnitPrice : input.purchaseGramPrice),
    saleGramPrice: dec(to === 'GRAM' ? input.saleUnitPrice : input.saleGramPrice),
    baseSaleGramPrice: dec(to === 'GRAM' ? input.baseSaleUnitPrice : input.baseSaleGramPrice),
    purchaseGramManual: true,
    saleUnitManual: input.saleUnitPrice !== null,
    saleGramManual: (to === 'GRAM' ? input.saleUnitPrice : input.saleGramPrice) !== null,
    // Explicitly entered prices must survive opening the regular editor again.
    saleRule: 'CUSTOM_AMOUNT' as const,
    saleRuleValue: null,
  };
}
function entryPlan(input: UnitCorrectionEntry, to: MaterialUnit) {
  const normalized = { ...input, adjustments: input.adjustments.map((row) => ({ ...row })) };
  normalized.purchaseTotalAmount ??= totalOf(input.receivedQty, input.purchaseUnitPrice);
  normalized.purchaseUnitPrice ??= priceOf(normalized.purchaseTotalAmount, input.receivedQty);
  if (to === 'GRAM') {
    normalized.purchaseGramPrice = normalized.purchaseUnitPrice;
    normalized.saleGramPrice = input.saleUnitPrice;
    normalized.baseSaleGramPrice = input.baseSaleUnitPrice;
    normalized.weightGrams = '1.00';
    normalized.purchaseTotalWeightGrams = input.receivedQty;
  } else {
    normalized.purchaseTotalWeightGrams ??= totalOf(input.receivedQty, input.weightGrams);
    if (normalized.purchaseTotalWeightGrams !== null) {
      const weight = priceOf(normalized.purchaseTotalWeightGrams, input.receivedQty);
      normalized.weightGrams ??= weight === '0.00' ? null : weight;
      normalized.purchaseGramPrice = priceOf(
        normalized.purchaseTotalAmount,
        normalized.purchaseTotalWeightGrams,
      );
      if (
        normalized.purchaseUnitPrice === null &&
        normalized.purchaseTotalAmount !== null &&
        normalized.weightGrams !== null &&
        dec(normalized.purchaseTotalWeightGrams)!.gt(0)
      ) {
        normalized.purchaseUnitPrice = bounded(
          dec(normalized.purchaseTotalAmount)!
            .mul(normalized.weightGrams)
            .div(normalized.purchaseTotalWeightGrams)
            .toDecimalPlaces(2),
        );
      }
    }
  }
  const patch = {
    ...pricingPatch(normalized, to),
    receivedQty: dec(normalized.receivedQty),
    remainingQty: dec(normalized.remainingQty),
    purchaseUnitInputs: Prisma.DbNull,
    purchaseTotalAmount: dec(normalized.purchaseTotalAmount),
    purchaseInputMode: normalized.purchaseTotalAmount !== null || to === 'GRAM' ? 'BATCH' : 'UNIT',
    purchaseTotalWeightGrams: dec(normalized.purchaseTotalWeightGrams),
    purchaseQuotedGramPrice: null,
    purchaseAutoField: null,
    sampleWeightGrams: to === 'GRAM' ? null : dec(normalized.weightGrams),
    manualPurchaseUnitPrice: to === 'GRAM' ? null : dec(normalized.purchaseUnitPrice),
    unitPriceSource:
      to === 'GRAM' ? 'AVERAGE' : normalized.purchaseUnitPrice !== null ? 'MANUAL' : 'UNKNOWN',
  } satisfies Prisma.MaterialBatchEntryUpdateInput;
  const issues: string[] = [];
  const quantities = [
    input.receivedQty,
    input.remainingQty,
    ...input.adjustments.flatMap((row) => [row.beforeQty, row.afterQty]),
  ];
  if (quantities.some((value) => value !== null && !validMaterialQuantity(Number(value), to)))
    issues.push('QUANTITY');
  if (input.receivedQty !== null && dec(input.receivedQty)!.lte(0)) issues.push('RECEIVED');
  if (to === 'GRAM') {
    if (input.receivedQty === null || dec(input.receivedQty)!.lte(0)) issues.push('RECEIVED');
    if (normalized.purchaseTotalAmount === null || normalized.purchaseUnitPrice === null)
      issues.push('GRAM_PURCHASE');
    else if (
      input.receivedQty !== null &&
      dec(input.receivedQty)!.gt(0) &&
      priceOf(normalized.purchaseTotalAmount, input.receivedQty) !==
        dec(normalized.purchaseUnitPrice)!.toFixed(2)
    )
      issues.push('COST_MISMATCH');
  }
  if (input.weightGrams !== null && dec(input.weightGrams)!.eq(0) && to !== 'GRAM')
    issues.push('WEIGHT');
  if (to !== 'GRAM' && normalized.purchaseTotalWeightGrams !== null) {
    if (dec(normalized.purchaseTotalWeightGrams)!.lte(0)) issues.push('WEIGHT');
    else if (
      input.receivedQty !== null &&
      dec(input.receivedQty)!.gt(0) &&
      input.weightGrams !== null &&
      priceOf(normalized.purchaseTotalWeightGrams, input.receivedQty) !==
        dec(input.weightGrams)!.toFixed(2)
    )
      issues.push('WEIGHT_MISMATCH');
  }
  return { patch, normalized, issues: [...new Set(issues)] };
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
function sameIds(actual: string[], expected: string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((id) => expected.includes(id))
  );
}
function previewOf(
  item: Item,
  to: MaterialUnit,
  supplied?: UnitCorrectionEdits,
): UnitCorrectionPreview {
  if (item.unit === to) throw new ApiError(400, 'INVALID_INPUT');
  const edits = unitCorrectionEditsSchema.parse(supplied ?? suggestions(item, to));
  if (
    !sameIds(
      edits.entries.map((row) => row.id),
      item.batchEntries.map((row) => row.id),
    )
  )
    throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
  const entries = item.batchEntries.map((entry) => {
    const input = edits.entries.find((row) => row.id === entry.id)!;
    if (
      !sameIds(
        input.adjustments.map((row) => row.id),
        entry.stockAdjustments.map((row) => row.id),
      )
    )
      throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
    const plan = entryPlan(input, to);
    return { entry, plan };
  });
  const canonical: UnitCorrectionEdits = {
    master: {
      ...edits.master,
      ...(to === 'GRAM'
        ? {
            weightGrams: '1.00',
            purchaseGramPrice: edits.master.purchaseUnitPrice,
            saleGramPrice: edits.master.saleUnitPrice,
            baseSaleGramPrice: edits.master.baseSaleUnitPrice,
          }
        : {}),
    },
    entries: entries.map(({ plan }) => plan.normalized),
  };
  return {
    name: item.name,
    from: item.unit,
    to,
    snapshot: createHash('sha256')
      .update(JSON.stringify({ item, to, edits: canonical }))
      .digest('hex'),
    edits: canonical,
    masterChanges: changes(item, pricingPatch(canonical.master, to)),
    entries: entries.map(({ entry, plan }) => ({
      id: entry.id,
      batch: entry.batch.name,
      distributor: entry.distributor.name,
      receivedQty: text(entry.receivedQty),
      remainingQty: text(entry.remainingQty),
      purchaseUnitPrice: text(entry.purchaseUnitPrice),
      saleUnitPrice: text(entry.saleUnitPrice),
      adjustmentCount: entry.stockAdjustments.length,
      adjustments: entry.stockAdjustments.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        beforeQty: text(row.beforeQty),
        afterQty: text(row.afterQty)!,
        reason: row.reason,
      })),
      changes: changes(entry, plan.patch),
      issues: plan.issues,
      diy: entry.diyLines.map((line) => ({
        id: line.id,
        productId: line.run.product.id,
        name: line.run.product.name,
        unit: line.usageUnit,
        conflict:
          to === 'GRAM' ? line.usageUnit !== 'GRAM' : to === 'BEAD' && line.usageUnit === 'STRAND',
      })),
    })),
  };
}
export async function previewUnitCorrection(
  id: string,
  to: MaterialUnit,
  edits?: UnitCorrectionEdits,
) {
  return db.$transaction(
    async (tx) => {
      const item = await tx.material.findUnique({ where: { id }, include });
      if (!item) throw new ApiError(404, 'NOT_FOUND');
      if (item.pricingGroupId && to !== 'GRAM') throw new ApiError(400, 'PRICING_GRAM_ONLY');
      return previewOf(item, to, edits);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export async function correctMaterialUnit(
  id: string,
  to: MaterialUnit,
  snapshot: string,
  edits?: UnitCorrectionEdits,
) {
  try {
    return await db.$transaction(
      async (tx) => {
        const item = await tx.material.findUnique({ where: { id }, include });
        if (!item) throw new ApiError(404, 'NOT_FOUND');
        if (item.pricingGroupId && to !== 'GRAM') throw new ApiError(400, 'PRICING_GRAM_ONLY');
        if (item.unit === to) throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
        const preview = previewOf(item, to, edits);
        if (preview.snapshot !== snapshot) throw new ApiError(409, 'MATERIAL_UNIT_CHANGED');
        if (
          preview.entries.some(
            (entry) => entry.issues.length || entry.diy.some((line) => line.conflict),
          )
        )
          throw new ApiError(409, 'MATERIAL_UNIT_CONFLICT');
        for (const entry of item.batchEntries) {
          const input = preview.edits.entries.find((row) => row.id === entry.id)!;
          await tx.materialBatchEntry.update({
            where: { id: entry.id },
            data: entryPlan(input, to).patch,
          });
          for (const row of input.adjustments) {
            const previous = entry.stockAdjustments.find((original) => original.id === row.id)!;
            if (
              text(previous.beforeQty) === text(dec(row.beforeQty)) &&
              text(previous.afterQty) === text(dec(row.afterQty))
            )
              continue;
            await tx.materialStockAdjustment.update({
              where: { id: row.id },
              data: {
                beforeQty: dec(row.beforeQty),
                afterQty: dec(row.afterQty)!,
                delta: row.beforeQty === null ? null : dec(row.afterQty)!.minus(row.beforeQty),
              },
            });
          }
        }
        await tx.material.update({
          where: { id },
          data: { ...pricingPatch(preview.edits.master, to), unit: to },
        });
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
