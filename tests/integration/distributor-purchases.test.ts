import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
import { db } from '../../src/lib/db';
import {
  getDistributorItemCounts,
  getDistributorPurchaseEntries,
  getDistributorPurchaseSummary,
} from '../../src/lib/distributor-purchases';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('distributor purchase queries', () => {
  it('groups by identity, isolates suppliers, handles unknown totals and pages the mixed result', async () => {
    const suffix = `distributor-${Date.now()}`;
    const category = await db.category.create({ data: { name: suffix }, select: { id: true } });
    const existingCabochonCategory = await db.category.findUnique({
      where: { name: '蛋面' },
      select: { id: true },
    });
    const cabochonCategory =
      existingCabochonCategory ??
      (await db.category.create({ data: { name: '蛋面' }, select: { id: true } }));
    const materialCategory = await db.materialCategory.create({ data: { name: suffix } });
    const supplier = await db.distributor.create({ data: { name: suffix, area: '网络' } });
    const other = await db.distributor.create({ data: { name: `${suffix}-other`, area: '网络' } });
    const batches = await Promise.all(
      [1, 2, 3].map((day) =>
        db.materialBatch.create({
          data: { name: `${suffix}-${day}`, receivedAt: new Date(`2026-10-0${day}T00:00:00Z`) },
        }),
      ),
    );
    const defaults = { type: 'all' as const, q: '', page: 1, pageSize: 20 };
    try {
      const products = await Promise.all(
        Array.from({ length: 22 }, (_, index) =>
          db.product.create({
            data: {
              name: '同名商品',
              code: `${suffix}-${index}`,
              categoryId: index === 1 ? cabochonCategory.id : category.id,
              priceCents: 0,
              origin: 'PURCHASED',
              purchaseEntries: {
                create: {
                  distributorId: supplier.id,
                  batchId: batches[index % 3].id,
                  quantity: 3,
                  unitCost: '0.10',
                },
              },
            },
          }),
        ),
      );
      // Same product and same batch: quantity accumulates but batch count stays one.
      await db.productPurchaseEntry.create({
        data: {
          productId: products[0].id,
          distributorId: supplier.id,
          batchId: batches[0].id,
          quantity: 7,
          unitCost: '0.20',
        },
      });
      await db.productPurchaseEntry.create({
        data: {
          productId: products[0].id,
          distributorId: supplier.id,
          batchId: batches[2].id,
          quantity: 1,
          unitCost: '0.10',
        },
      });
      await db.productPurchaseEntry.create({
        data: {
          productId: products[0].id,
          distributorId: other.id,
          batchId: batches[1].id,
          quantity: 999,
          unitCost: '999',
        },
      });
      const material = await db.material.create({
        data: {
          name: '同名商品',
          categoryId: materialCategory.id,
          unit: 'BEAD',
          batchEntries: {
            create: [
              {
                batchId: batches[0].id,
                distributorId: supplier.id,
                receivedQty: 2,
                remainingQty: 2,
                purchaseUnitPrice: '0.10',
                weightGrams: '0.15',
              },
              {
                batchId: batches[1].id,
                distributorId: supplier.id,
                receivedQty: null,
                remainingQty: null,
                purchaseInputMode: 'BATCH',
                purchaseTotalAmount: '1.01',
                purchaseTotalWeightGrams: '0.25',
                purchaseUnitPrice: '999.99',
                weightGrams: '999.99',
                unitPriceSource: 'ESTIMATED',
              },
              {
                batchId: batches[2].id,
                distributorId: supplier.id,
                receivedQty: null,
                remainingQty: null,
                purchaseInputMode: 'BATCH',
              },
            ],
          },
        },
      });
      const unknownMaterial = await db.material.create({
        data: {
          name: '全未知',
          categoryId: materialCategory.id,
          unit: 'STRAND',
          batchEntries: {
            create: {
              batchId: batches[0].id,
              distributorId: supplier.id,
              receivedQty: null,
              remainingQty: null,
              purchaseTotalAmount: '0',
              purchaseInputMode: 'BATCH',
            },
          },
        },
      });
      const entry = await db.materialBatchEntry.findFirstOrThrow({
        where: { materialId: material.id },
      });
      await db.product.create({
        data: {
          name: 'DIY排除',
          code: `${suffix}-diy`,
          categoryId: category.id,
          priceCents: 0,
          origin: 'DIY',
          diyRuns: {
            create: {
              quantity: 1,
              perUnitCost: '0.10',
              materialLines: {
                create: {
                  materialBatchEntryId: entry.id,
                  usageUnit: 'BEAD',
                  quantity: '1',
                  unitCost: '0.10',
                  lineCost: '0.10',
                  position: 0,
                },
              },
            },
          },
        },
      });
      const first = await getDistributorPurchaseSummary(supplier.id, defaults);
      const counts = await getDistributorItemCounts();
      expect(counts.get(supplier.id)).toEqual({ total: 24, products: 22, materials: 2 });
      expect(counts.get(other.id)).toEqual({ total: 1, products: 1, materials: 0 });
      const second = await getDistributorPurchaseSummary(supplier.id, { ...defaults, page: 2 });
      expect(first.total).toBe(24);
      expect(first.items).toHaveLength(20);
      expect(second.items).toHaveLength(4);
      const all = [...first.items, ...second.items];
      expect(new Set(all.map((row) => `${row.type}:${row.itemId}`)).size).toBe(24);
      expect(all.map((row) => `${row.latestReceivedAt}:${row.type}:${row.itemId}`)).toEqual(
        [...all]
          .sort(
            (a, b) =>
              b.latestReceivedAt.localeCompare(a.latestReceivedAt) ||
              (a.type < b.type ? -1 : a.type > b.type ? 1 : a.itemId < b.itemId ? -1 : 1),
          )
          .map((row) => `${row.latestReceivedAt}:${row.type}:${row.itemId}`),
      );
      expect(all.find((row) => row.itemId === products[0].id)).toMatchObject({
        batchCount: 2,
        knownQuantity: 11,
        totalAmount: '1.80',
        hasUnknownQuantity: false,
      });
      expect(all.find((row) => row.itemId === material.id)).toMatchObject({
        batchCount: 3,
        knownQuantity: 2,
        hasUnknownQuantity: true,
        totalAmount: '1.21',
        hasUnknownAmount: true,
        totalWeightGrams: '0.55',
        hasUnknownWeight: true,
      });
      expect(all.find((row) => row.itemId === unknownMaterial.id)).toMatchObject({
        knownQuantity: null,
        hasUnknownQuantity: true,
        totalAmount: '0.00',
        hasUnknownAmount: false,
      });
      expect(
        (await getDistributorPurchaseSummary(supplier.id, { ...defaults, type: 'product' })).total,
      ).toBe(22);
      expect(all.some((row) => row.itemId === products[1].id && row.type === 'PRODUCT')).toBe(true);
      expect(
        (await getDistributorPurchaseSummary(supplier.id, { ...defaults, type: 'material' })).total,
      ).toBe(2);
      expect(
        (
          await getDistributorPurchaseSummary(supplier.id, {
            ...defaults,
            q: products[0].code.toUpperCase(),
          })
        ).items,
      ).toHaveLength(1);
      expect(
        (await getDistributorPurchaseSummary(supplier.id, { ...defaults, q: '%' })).total,
      ).toBe(0);
      expect(
        await getDistributorPurchaseSummary(supplier.id, { ...defaults, page: 99 }),
      ).toMatchObject({ items: [], total: 24 });
      const materialDetails = await getDistributorPurchaseEntries(supplier.id, {
        type: 'material',
        itemId: material.id,
        page: 1,
        pageSize: 20,
      });
      expect(materialDetails.items[0].quantity).toBeNull();
      expect(materialDetails.items[1]).toMatchObject({
        quantity: null,
        amount: '1.01',
        weightGrams: '0.25',
        priceSource: 'ESTIMATED',
      });
      expect(materialDetails.items[2]).toMatchObject({
        quantity: 2,
        amount: '0.20',
        weightGrams: '0.30',
      });
      const productDetails = await getDistributorPurchaseEntries(supplier.id, {
        type: 'product',
        itemId: products[0].id,
        page: 2,
        pageSize: 1,
      });
      expect(productDetails.total).toBe(3);
      expect(productDetails.items).toHaveLength(1);
      expect(productDetails.items[0].batchId).toBe(batches[0].id);
      expect(
        (
          await getDistributorPurchaseEntries(other.id, {
            type: 'material',
            itemId: material.id,
            page: 1,
            pageSize: 20,
          })
        ).total,
      ).toBe(0);
      await expect(
        getDistributorPurchaseSummary('cmissingdistributor0000000', defaults),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      const productWhere = { code: { startsWith: `${suffix}-` } };
      await db.productDiyRun.deleteMany({ where: { product: productWhere } });
      await db.productPurchaseEntry.deleteMany({
        where: { distributorId: { in: [supplier.id, other.id] } },
      });
      await db.product.deleteMany({ where: productWhere });
      await db.materialBatchEntry.deleteMany({
        where: { distributorId: { in: [supplier.id, other.id] } },
      });
      await db.material.deleteMany({ where: { categoryId: materialCategory.id } });
      await db.materialBatch.deleteMany({
        where: { id: { in: batches.map((batch) => batch.id) } },
      });
      await db.distributor.deleteMany({ where: { id: { in: [supplier.id, other.id] } } });
      await db.category.delete({ where: { id: category.id }, select: { id: true } });
      if (!existingCabochonCategory)
        await db.category.delete({ where: { id: cabochonCategory.id }, select: { id: true } });
      await db.materialCategory.delete({ where: { id: materialCategory.id } });
    }
  });
});
