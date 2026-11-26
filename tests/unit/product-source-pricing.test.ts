import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/diy-picker/recent', () => ({ recordSavedDiyUsage: vi.fn() }));

import { addProductSource, updateProductSource } from '@/lib/product-sources';
import { sourceRulePriceChangeSchema } from '@/lib/product-source-write';

const source = {
  origin: 'DIY' as const,
  quantity: 2,
  materials: [],
  cabochons: [],
  pricingLines: [],
  extraCosts: [{ name: '包装', amount: '2', quoteAmount: '5' }],
  notes: '新用料',
};
const pricing = { priceCents: 42900, expectedPriceCents: 38880 };
const initial = () => ({
  product: {
    id: 'product',
    origin: 'DIY',
    priceCents: 38880,
    saleManual: false,
    saleRule: 'PERCENT_50' as const,
    saleRuleValue: null as string | null,
    stock: 2,
  },
  run: {
    id: 'run',
    productId: 'product',
    quantity: 2,
    materialLines: [],
    cabochonLines: [],
    pricingLines: [],
    notes: '原用料',
    perUnitCost: '2.00',
  },
});
let state = initial();
const tx = {
  priceScheme: { findMany: vi.fn(async () => []) },
  product: {
    findUnique: vi.fn(async () => ({ ...state.product })),
    findUniqueOrThrow: vi.fn(async () => ({ ...state.product })),
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async ({ where, data }) => {
      if (where.priceCents !== undefined && where.priceCents !== state.product.priceCents)
        return { count: 0 };
      if (
        where.saleRule !== undefined &&
        (where.saleRule !== state.product.saleRule ||
          where.saleRuleValue !== state.product.saleRuleValue ||
          where.saleManual !== state.product.saleManual)
      )
        return { count: 0 };
      if (data.stock) state.product.stock += data.stock.increment;
      else Object.assign(state.product, data);
      return { count: 1 };
    }),
  },
  materialBatchEntry: { findMany: vi.fn(async () => []) },
  productDiyRun: {
    findUnique: vi.fn(async () => ({
      ...state.run,
      perUnitCost: new Prisma.Decimal(state.run.perUnitCost),
    })),
    update: vi.fn(async ({ data }) => Object.assign(state.run, data)),
    create: vi.fn(async ({ data }) => Object.assign(state.run, data)),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  state = initial();
  mocks.transaction.mockImplementation(async (operation) => {
    const snapshot = structuredClone(state);
    try {
      return await operation(tx);
    } catch (error) {
      state = snapshot;
      throw error;
    }
  });
});

describe('DIY source and sale price transaction', () => {
  function automaticPricing(rule = 'PERCENT_50', value: string | null = null, manual = false) {
    return sourceRulePriceChangeSchema.parse({
      ...pricing,
      saleRule: rule,
      saleRuleValue: value,
      saleManual: manual,
      expectedPricing: { saleRule: 'PERCENT_50', saleRuleValue: null, saleManual: false },
    });
  }

  it.each(['add', 'edit'])(
    'recalculates %s pricing from the saved unit cost and persists the rule',
    async (mode) => {
      const next = {
        ...source,
        quantity: 3,
        extraCosts: [{ name: '费用', amount: '100', quoteAmount: '200' }],
      };
      if (mode === 'add') await addProductSource('product', next, automaticPricing());
      else await updateProductSource('product', 'run', next, automaticPricing());
      expect(state.product).toMatchObject({
        priceCents: 15000,
        saleRule: 'PERCENT_50',
        saleRuleValue: null,
        saleManual: false,
      });
      expect(state.run).toMatchObject({ perUnitCost: '100.00', totalCost: '300.00' });
    },
  );

  it.each([
    ['FIXED_AMOUNT', '25', 2700],
    ['CUSTOM_PERCENT', '12.34', 225],
    ['FIXED_AMOUNT', '-1', 100],
  ] as const)(
    'saves %s and its parameter with the calculated unit price',
    async (rule, value, expected) => {
      await updateProductSource('product', 'run', source, automaticPricing(rule, value));
      expect(state.product).toMatchObject({
        priceCents: expected,
        saleRule: rule,
        saleRuleValue: value,
        saleManual: false,
      });
    },
  );

  it('preserves explicit manual pricing together with its selected rule', async () => {
    await updateProductSource(
      'product',
      'run',
      source,
      automaticPricing('FIXED_AMOUNT', '25', true),
    );
    expect(state.product).toMatchObject({
      priceCents: 42900,
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: '25',
      saleManual: true,
    });
  });

  it('rejects a concurrent rule change even when the sale price is unchanged', async () => {
    state.product.saleRuleValue = '10';
    const snapshot = structuredClone(state);
    await expect(
      updateProductSource('product', 'run', source, automaticPricing()),
    ).rejects.toMatchObject({ code: 'PRODUCT_PRICE_CHANGED' });
    expect(state).toEqual(snapshot);
  });

  it.each(['add', 'edit'])(
    'saves %s and manual pricing in one serializable transaction',
    async (mode) => {
      if (mode === 'add') await addProductSource('product', source, pricing);
      else await updateProductSource('product', 'run', source, pricing);
      expect(state.product).toMatchObject({
        priceCents: 42900,
        saleManual: true,
        stock: mode === 'add' ? 4 : 2,
      });
      expect(state.run).toMatchObject({
        notes: '新用料',
        perUnitCost: '2.00',
        perUnitQuote: '5.00',
      });
      expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    },
  );

  it.each(['add', 'edit'])('preserves price and pricing rule on a source-only %s', async (mode) => {
    if (mode === 'add') await addProductSource('product', source);
    else await updateProductSource('product', 'run', source);
    expect(state.product).toMatchObject({ priceCents: 38880, saleManual: false });
  });

  it('rolls back the production record when the price is stale', async () => {
    state.product.priceCents = 40000;
    await expect(updateProductSource('product', 'run', source, pricing)).rejects.toMatchObject({
      code: 'PRODUCT_PRICE_CHANGED',
    });
    expect(state.product.priceCents).toBe(40000);
    expect(state.run.notes).toBe('原用料');
  });

  it('rolls back the price when the source write fails', async () => {
    tx.productDiyRun.update.mockRejectedValueOnce(new Error('source write failed'));
    await expect(updateProductSource('product', 'run', source, pricing)).rejects.toThrow(
      'source write failed',
    );
    expect(state).toEqual(initial());
  });

  it('rolls back the source if the price write fails', async () => {
    tx.product.updateMany.mockRejectedValueOnce(new Error('price write failed'));
    await expect(updateProductSource('product', 'run', source, pricing)).rejects.toThrow(
      'price write failed',
    );
    expect(state).toEqual(initial());
  });

  it('rejects a source belonging to another product and rolls back the price', async () => {
    tx.productDiyRun.findUnique.mockResolvedValueOnce({
      ...state.run,
      productId: 'other',
      perUnitCost: new Prisma.Decimal(state.run.perUnitCost),
    });
    await expect(updateProductSource('product', 'run', source, pricing)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(state).toEqual(initial());
  });
});
