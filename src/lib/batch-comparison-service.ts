import { db } from './db';
import { ApiError } from './api';
import {
  buildBatchComparison,
  comparisonRatio,
  multiplyComparison,
  type ComparisonQuery,
} from './batch-comparison';
import type { ComparisonEntry, ComparisonKind, ComparisonUnit } from './batch-comparison-contracts';

const relations = {
  batch: { select: { id: true, name: true, receivedAt: true, notes: true } },
  distributor: { select: { id: true, name: true } },
} as const;
const decimal = (value: { toString(): string } | null) => value?.toString() ?? null;

export async function getBatchComparison(kind: ComparisonKind, id: string, query: ComparisonQuery) {
  if (kind === 'product') {
    const product = await db.product.findUnique({
      where: { id },
      include: { purchaseEntries: { include: relations, orderBy: { id: 'asc' } } },
    });
    if (!product) throw new ApiError(404, 'NOT_FOUND');
    const entries: ComparisonEntry[] = product.purchaseEntries.map((entry) => ({
      id: entry.id,
      batch: { ...entry.batch, receivedAt: entry.batch.receivedAt.toISOString().slice(0, 10) },
      distributor: entry.distributor,
      quantity: String(entry.quantity),
      amount: multiplyComparison(String(entry.quantity), entry.unitCost.toString()),
      quantities: { PIECE: String(entry.quantity) },
      prices: { PIECE: entry.unitCost.toString() },
      priceSource: 'UNIT',
      remainingQuantity: null,
      remainingPercent: null,
      inventoryValue: null,
      dimensions: null,
      notes: entry.notes,
      href: `/admin/materials/batches/${encodeURIComponent(entry.batchId)}`,
    }));
    return buildBatchComparison(
      { id, name: product.name, kind, unit: 'PIECE' },
      entries,
      query,
      String(product.stock),
    );
  }
  const material = await db.material.findUnique({
    where: { id },
    include: { batchEntries: { include: relations, orderBy: { id: 'asc' } } },
  });
  if (!material) throw new ApiError(404, 'NOT_FOUND');
  const unit: ComparisonUnit = material.unit;
  const entries: ComparisonEntry[] = material.batchEntries.map((entry) => {
    const quantity = decimal(entry.receivedQty);
    const unitCost = decimal(unit === 'GRAM' ? entry.purchaseGramPrice : entry.purchaseUnitPrice);
    const amount = decimal(entry.purchaseTotalAmount) ?? multiplyComparison(quantity, unitCost);
    const weight =
      decimal(entry.purchaseTotalWeightGrams) ??
      (unit === 'GRAM' ? quantity : multiplyComparison(quantity, decimal(entry.weightGrams)));
    const beads =
      unit === 'BEAD'
        ? quantity
        : unit === 'STRAND'
          ? multiplyComparison(quantity, decimal(entry.childCount))
          : null;
    const quantities = {
      [unit]: quantity,
      GRAM: weight,
      ...(unit !== 'GRAM' ? { BEAD: beads } : {}),
    };
    const prices = {
      [unit]: comparisonRatio(amount, quantity) ?? unitCost,
      GRAM: comparisonRatio(amount, weight) ?? decimal(entry.purchaseGramPrice),
      ...(unit !== 'GRAM'
        ? {
            BEAD:
              comparisonRatio(amount, beads) ??
              decimal(unit === 'BEAD' ? entry.purchaseUnitPrice : entry.childUnitPrice),
          }
        : {}),
    };
    const remainingQuantity = decimal(entry.remainingQty);
    return {
      id: entry.id,
      batch: { ...entry.batch, receivedAt: entry.batch.receivedAt.toISOString().slice(0, 10) },
      distributor: entry.distributor,
      quantity,
      amount,
      quantities,
      prices,
      priceSource: entry.unitPriceSource,
      remainingQuantity,
      remainingPercent: multiplyComparison(comparisonRatio(remainingQuantity, quantity), '100'),
      inventoryValue:
        remainingQuantity === '0' ? '0.00' : multiplyComparison(remainingQuantity, unitCost),
      dimensions: {
        lengthMm: decimal(entry.lengthMm),
        widthMm: decimal(entry.widthMm),
        heightMm: decimal(entry.heightMm),
        childCount: entry.childCount,
        weightGrams: decimal(entry.weightGrams),
      },
      notes: entry.batch.notes,
      href: `/admin/materials/${encodeURIComponent(id)}/batches/${encodeURIComponent(entry.id)}`,
    };
  });
  return buildBatchComparison({ id, name: material.name, kind, unit }, entries, query);
}
