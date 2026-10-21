import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));

import { saveProduct } from '../../src/lib/products';
import { productSchema } from '../../src/lib/validation';

const id = 'clx1234567890123456789011';
const input = {
  code: 'A0001',
  name: '修改后的商品',
  categoryId: 'clx1234567890123456789012',
  description: '',
  priceCents: 100,
  currency: 'CNY' as const,
  stock: 7,
  published: false,
  imageKeys: [],
};

function transaction() {
  const product = {
    ...input,
    id,
    name: '原商品',
    stock: 10,
    origin: 'PURCHASED',
    images: [],
    tags: [],
    marketing: null,
    measurement: null,
    cost: null,
    purchaseEntries: [],
    diyRuns: [],
    stockAdjustments: [] as object[],
  };
  return {
    category: {
      findUnique: vi.fn().mockResolvedValue({ id: input.categoryId, name: '手链', prefix: 'A' }),
    },
    product: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...product })),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...product })),
      update: vi.fn().mockImplementation(async ({ data }) => Object.assign(product, data)),
      updateMany: vi.fn().mockImplementation(async ({ data }) => {
        product.stock += data.stock.increment;
        return { count: 1 };
      }),
    },
    productCode: { upsert: vi.fn() },
    uploadGrant: { findMany: vi.fn().mockResolvedValue([]) },
    cabochonMeasurement: { deleteMany: vi.fn() },
    cabochonCost: { deleteMany: vi.fn() },
    productImage: { deleteMany: vi.fn() },
    productStockAdjustment: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        product.stockAdjustments.push(data);
        return data;
      }),
    },
  };
}

let tx: ReturnType<typeof transaction>;
beforeEach(() => {
  vi.clearAllMocks();
  tx = transaction();
  mocks.transaction.mockImplementation(async (operation) => operation(tx));
});

describe('inline product stock edits', () => {
  it.each([0, 3, 15])(
    'saves actual stock %s and its audit in the product transaction',
    async (stock) => {
      const saved = await saveProduct(
        productSchema.parse({
          ...input,
          stock,
          stockAdjustment: { expectedQuantity: 10, reason: '  盘点更正  ' },
        }),
        id,
      );
      expect(saved).toMatchObject({ name: input.name, stock });
      expect(saved.stockAdjustments).toEqual([
        { productId: id, beforeQty: 10, afterQty: stock, delta: stock - 10, reason: '盘点更正' },
      ]);
      expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    },
  );

  it('uses the default reason and does not log a second adjustment on a normal resave', async () => {
    await saveProduct(
      productSchema.parse({ ...input, stockAdjustment: { expectedQuantity: 10 } }),
      id,
    );
    const saved = await saveProduct(input, id);
    expect(saved.stock).toBe(7);
    expect(saved.stockAdjustments).toHaveLength(1);
    expect(saved.stockAdjustments[0].reason).toBe('手动盘点');
  });

  it('preserves live inventory when only product details are saved with an old stock value', async () => {
    const saved = await saveProduct(input, id);
    expect(saved).toMatchObject({ name: input.name, stock: 10 });
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.productStockAdjustment.create).not.toHaveBeenCalled();
  });

  it('does not add history when the requested stock is unchanged', async () => {
    await saveProduct(
      productSchema.parse({ ...input, stock: 10, stockAdjustment: { expectedQuantity: 10 } }),
      id,
    );
    expect(tx.productStockAdjustment.create).not.toHaveBeenCalled();
  });

  it('rejects a stale stock snapshot before writing either stock or product details', async () => {
    await expect(
      saveProduct(productSchema.parse({ ...input, stockAdjustment: { expectedQuantity: 9 } }), id),
    ).rejects.toMatchObject({ status: 409, code: 'STOCK_CHANGED' });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.productStockAdjustment.create).not.toHaveBeenCalled();
  });

  it('rechecks inventory after a serializable transaction conflict', async () => {
    mocks.transaction.mockImplementationOnce(async (operation) => {
      await operation(tx);
      throw new Prisma.PrismaClientKnownRequestError('concurrent update', {
        code: 'P2034',
        clientVersion: 'test',
      });
    });
    const concurrent = transaction();
    concurrent.product.findUnique.mockResolvedValue({ ...input, id, stock: 12, images: [] });
    mocks.transaction.mockImplementationOnce(async (operation) => operation(concurrent));
    await expect(
      saveProduct(productSchema.parse({ ...input, stockAdjustment: { expectedQuantity: 10 } }), id),
    ).rejects.toMatchObject({ code: 'STOCK_CHANGED' });
    expect(concurrent.product.update).not.toHaveBeenCalled();
    expect(concurrent.productStockAdjustment.create).not.toHaveBeenCalled();
  });

  it('rejects the entire save if the history write fails', async () => {
    tx.productStockAdjustment.create.mockRejectedValue(new Error('history write failed'));
    await expect(
      saveProduct(productSchema.parse({ ...input, stockAdjustment: { expectedQuantity: 10 } }), id),
    ).rejects.toThrow('history write failed');
    expect(tx.product.update).not.toHaveBeenCalled();
  });
});
