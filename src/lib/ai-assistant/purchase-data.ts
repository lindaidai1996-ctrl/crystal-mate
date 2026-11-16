import type { Prisma } from '@prisma/client';
import { CandidateQueryError } from './candidate-contracts';
import { readAssistantCandidates } from './candidate-data';
import { purchaseEntrySchema, type PurchaseQuery, type PurchaseEntry } from './purchase-contracts';
import { PurchaseDecimal, exactPurchaseDecimal, purchaseIdentity } from './purchase-summary';

export async function readAssistantPurchases(tx: Prisma.TransactionClient, input: PurchaseQuery) {
  const scope = await readAssistantCandidates(tx, input.query);
  const available = new Set(scope.map((r) => purchaseIdentity(r.candidate.purchase!)));
  if (input.selectedPurchases?.some((r) => !available.has(purchaseIdentity(r))))
    throw new CandidateQueryError('PURCHASE_OUTSIDE_SCOPE');
  const selected = input.selectedPurchases
    ? new Set(input.selectedPurchases.map(purchaseIdentity))
    : null;
  const candidates = selected
    ? scope.filter((r) => selected.has(purchaseIdentity(r.candidate.purchase!)))
    : scope;
  const materialIds = candidates
    .filter((r) => r.candidate.item.type === 'MATERIAL')
    .map((r) => r.candidate.purchase!.id);
  const productIds = candidates
    .filter((r) => r.candidate.item.type === 'PRODUCT')
    .map((r) => r.candidate.purchase!.id);
  const [materials, products] = await Promise.all([
    materialIds.length
      ? tx.materialBatchEntry.findMany({
          where: { id: { in: materialIds } },
          select: {
            id: true,
            materialId: true,
            batchId: true,
            distributorId: true,
            receivedQty: true,
            purchaseUnitPrice: true,
            purchaseTotalAmount: true,
            material: { select: { unit: true } },
          },
        })
      : [],
    productIds.length
      ? tx.productPurchaseEntry.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            productId: true,
            batchId: true,
            distributorId: true,
            quantity: true,
            unitCost: true,
          },
        })
      : [],
  ]);
  const materialById = new Map(materials.map((r) => [r.id, r]));
  const productById = new Map(products.map((r) => [r.id, r]));
  const rows: PurchaseEntry[] = candidates.map((detail) => {
    const { item, purchase, evidence } = detail.candidate;
    if (!purchase || !detail.batch || !detail.distributor)
      throw new CandidateQueryError('INVALID_PURCHASE_RELATION');
    const text = (type: string, id: string, field: string) => {
      const value = evidence.find(
        (e) => e.entity.type === type && e.entity.id === id && e.field === field,
      )?.value;
      if (typeof value !== 'string') throw new CandidateQueryError('INVALID_PURCHASE_EVIDENCE');
      return value;
    };
    const material = item.type === 'MATERIAL' ? materialById.get(purchase.id) : undefined;
    const product = item.type === 'PRODUCT' ? productById.get(purchase.id) : undefined;
    const source = material ?? product;
    if (
      !source ||
      (material?.materialId ?? product?.productId) !== item.id ||
      source.batchId !== detail.batch.id ||
      source.distributorId !== detail.distributor.id
    )
      throw new CandidateQueryError('PURCHASE_SNAPSHOT_CHANGED');
    const quantity = material ? material.receivedQty : product!.quantity;
    const unitPrice = material ? material.purchaseUnitPrice : product!.unitCost;
    const recorded = material?.purchaseTotalAmount ?? null;
    const amount =
      recorded ??
      (quantity !== null && unitPrice !== null
        ? new PurchaseDecimal(quantity.toString()).mul(unitPrice.toString())
        : null);
    return purchaseEntrySchema.parse({
      item,
      purchase,
      name: text(item.type, item.id, 'name'),
      code: detail.code,
      batch: {
        id: detail.batch.id,
        name: text('BATCH', detail.batch.id, 'name'),
        receivedAt: text('BATCH', detail.batch.id, 'receivedAt'),
      },
      distributor: {
        id: detail.distributor.id,
        name: text('DISTRIBUTOR', detail.distributor.id, 'name'),
      },
      quantity: quantity === null ? null : exactPurchaseDecimal(quantity),
      unit: material ? material.material.unit : 'PIECE',
      unitPrice: unitPrice === null ? null : exactPurchaseDecimal(unitPrice),
      amount: amount === null ? null : exactPurchaseDecimal(amount),
      amountBasis:
        recorded !== null
          ? 'recorded_total'
          : amount !== null
            ? 'quantity_times_unit_price'
            : 'unknown',
      // No purchase-currency field exists. Never infer it from Product.currency (sale currency).
      currency: 'CNY',
      currencyBasis: 'business_default',
    });
  });
  return { candidates, rows, scopeCandidateCount: scope.length };
}
