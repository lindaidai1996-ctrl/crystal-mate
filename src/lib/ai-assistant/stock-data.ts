import type { Prisma } from '@prisma/client';
import { materialStockSummary } from '@/lib/inventory';
import { readAssistantCandidates } from './candidate-data';
import { CANDIDATE_LIMIT, CandidateQueryError } from './candidate-contracts';
import { PurchaseDecimal, exactPurchaseDecimal } from './purchase-summary';
import {
  stockQuerySchema,
  stockResultSchema,
  type CatalogStock,
  type SourceStock,
  type StockResult,
} from './stock-contracts';

const key = (ref: { type: string; id: string }) => `${ref.type}:${ref.id}`;
// Internal reader: the authenticated service owns the read-only transaction.
export async function readAssistantStock(
  tx: Prisma.TransactionClient,
  rawInput: unknown,
): Promise<StockResult> {
  const input = stockQuerySchema.parse(rawInput);
  const queriedAt = new Date().toISOString();
  const scope = await readAssistantCandidates(tx, input.query);
  const ref = (row: (typeof scope)[number]) =>
    input.query.subject === 'catalog' ? row.candidate.item : row.candidate.purchase!;
  const selection = input.selectedItems ?? input.selectedPurchases;
  const available = new Set(scope.map((row) => key(ref(row))));
  if (selection?.some((r) => !available.has(key(r))))
    throw new CandidateQueryError('STOCK_SELECTION_OUTSIDE_SCOPE');
  const selectedKeys = selection ? new Set(selection.map(key)) : null;
  const selected = selectedKeys ? scope.filter((row) => selectedKeys.has(key(ref(row)))) : scope;
  const items = new Map(selected.map((row) => [key(row.candidate.item), row.candidate.item]));
  const materialIds = [...items.values()].filter((r) => r.type === 'MATERIAL').map((r) => r.id);
  const productIds = [...items.values()].filter((r) => r.type === 'PRODUCT').map((r) => r.id);
  const sourceIds = selected
    .map((r) => r.candidate.purchase?.id)
    .filter((id): id is string => !!id);
  const [materials, products, entries] = await Promise.all([
    materialIds.length
      ? tx.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, name: true, unit: true },
        })
      : [],
    productIds.length
      ? tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, stock: true },
        })
      : [],
    materialIds.length
      ? tx.materialBatchEntry.findMany({
          // Historical purchase filters only determine objects. Never propagate them here.
          where:
            input.mode === 'catalog_current'
              ? { materialId: { in: materialIds } }
              : { id: { in: sourceIds } },
          select: {
            id: true,
            materialId: true,
            batchId: true,
            receivedQty: true,
            remainingQty: true,
          },
          orderBy: [{ batch: { receivedAt: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }],
          take: CANDIDATE_LIMIT + 1,
        })
      : [],
  ]);
  if (entries.length > CANDIDATE_LIMIT) throw new CandidateQueryError('STOCK_BUDGET_EXCEEDED');
  if (materials.length !== materialIds.length || products.length !== productIds.length)
    throw new CandidateQueryError('STOCK_SNAPSHOT_CHANGED');
  const materialById = new Map(materials.map((r) => [r.id, r]));
  const byMaterial = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = byMaterial.get(entry.materialId) ?? [];
    group.push(entry);
    byMaterial.set(entry.materialId, group);
  }
  const catalogStock: CatalogStock[] = [];
  const sourceStock: SourceStock[] = [];
  if (input.mode === 'catalog_current') {
    for (const row of materials) {
      const batches = byMaterial.get(row.id) ?? [];
      // Same serialization and iteration order as serializeMaterial / business page.
      const summary = materialStockSummary(
        batches.map((e) => ({ remainingQty: e.remainingQty?.toNumber() ?? null })),
      );
      catalogStock.push({
        item: { type: 'MATERIAL', id: row.id },
        name: row.name,
        unit: row.unit,
        knownStock: exactPurchaseDecimal(summary.knownStock),
        unknownStockBatchCount: summary.unknownStockBatchCount,
        stockBatchCount: batches.length,
      });
    }
    for (const row of products)
      catalogStock.push({
        item: { type: 'PRODUCT', id: row.id },
        name: row.name,
        unit: 'PIECE',
        knownStock: exactPurchaseDecimal(row.stock),
        unknownStockBatchCount: 0,
        stockBatchCount: null,
      });
    catalogStock.sort((a, b) => (key(a.item) < key(b.item) ? -1 : 1));
  } else {
    const byId = new Map(entries.map((r) => [r.id, r]));
    for (const detail of selected) {
      const { item, purchase } = detail.candidate;
      const entry = purchase && byId.get(purchase.id);
      const material = materialById.get(item.id);
      if (!entry || !material || entry.materialId !== item.id || entry.batchId !== detail.batch?.id)
        throw new CandidateQueryError('STOCK_SNAPSHOT_CHANGED');
      sourceStock.push({
        item: { type: 'MATERIAL', id: item.id },
        purchase: { type: 'MATERIAL_PURCHASE', id: entry.id },
        batch: { type: 'BATCH', id: entry.batchId },
        name: material.name,
        unit: material.unit,
        purchasedQuantity:
          entry.receivedQty === null ? null : exactPurchaseDecimal(entry.receivedQty),
        remainingQuantity:
          entry.remainingQty === null ? null : exactPurchaseDecimal(entry.remainingQty),
      });
    }
    sourceStock.sort((a, b) => (a.purchase.id < b.purchase.id ? -1 : 1));
  }
  const totals = new Map<string, StockResult['quantities'][number]>();
  const add = (
    unit: StockResult['quantities'][number]['unit'],
    known: string,
    unknownBatches: number,
  ) => {
    const group = totals.get(unit) ?? {
      unit,
      knownStock: '0.00',
      unknownStockObjectCount: 0,
      unknownStockBatchCount: 0,
    };
    group.knownStock = exactPurchaseDecimal(new PurchaseDecimal(group.knownStock).add(known));
    group.unknownStockObjectCount += Number(unknownBatches > 0);
    group.unknownStockBatchCount += unknownBatches;
    totals.set(unit, group);
  };
  for (const row of catalogStock) add(row.unit, row.knownStock, row.unknownStockBatchCount);
  for (const row of sourceStock)
    add(row.unit, row.remainingQuantity ?? '0.00', Number(row.remainingQuantity === null));
  return stockResultSchema.parse({
    version: 'v1',
    queriedAt,
    request: input,
    scopeCandidateCount: scope.length,
    selectedCandidateCount: selected.length,
    catalogItemCount: items.size,
    traversal: 'complete',
    semanticEvaluation: 'not_performed',
    catalogStock,
    sourceStock,
    quantities: [...totals.values()].sort((a, b) => (a.unit < b.unit ? -1 : 1)),
  });
}
