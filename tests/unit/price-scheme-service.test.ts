import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import { previewSchemeChange, commitSchemeChange } from '@/lib/price-schemes/service';
import {
  syncSchemePrices,
  priceStateToken,
  checkPriceState,
  hash,
  type Tx,
  type PricingProduct,
} from '@/lib/price-schemes/store';
import type { SchemeChange, SchemeInput } from '@/lib/price-schemes/contracts';
const id = (n: number) => `clx${String(n).padStart(22, '0')}`;
const base: SchemeInput = {
  name: '平台价',
  formula: 'direct / 0.95',
  common: true,
  rounding: 'CENT',
  position: 0,
};
type Scheme = SchemeInput & { id: string; version: number };
type Price = {
  id: string;
  productId: string;
  schemeId: string;
  mode: string;
  amountCents: number | null;
  previousAmountCents: number | null;
  error: string | null;
  schemeVersion: number;
  basis: object;
  version: number;
};
let schemes: Scheme[],
  prices: Price[],
  products: Array<{ id: string; name: string; code: string; direct: number }>,
  revisions: object[],
  failWrite: boolean;
function product(row: (typeof products)[number]): PricingProduct {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    priceCents: row.direct,
    currency: 'CNY',
    category: { name: '手链' },
    cost: null,
    origin: 'PURCHASED',
    purchaseEntries: [
      { id: id(10), createdAt: new Date('2026-11-26'), unitCost: new Prisma.Decimal('50') },
    ],
    diyRuns: [],
    schemePrices: prices
      .filter((p) => p.productId === row.id)
      .map((p) => ({
        ...p,
        createdAt: new Date(),
        updatedAt: new Date(),
        basis: p.basis as Prisma.JsonObject,
        scheme: {
          ...schemes.find((s) => s.id === p.schemeId)!,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })),
  };
}
const tx = {
  priceScheme: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      schemes.find((s) => s.id === where.id) ?? null,
    findMany: async () => schemes,
    create: async ({ data }: { data: SchemeInput }) => {
      const row = { ...data, id: id(90), version: 1 };
      schemes.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: SchemeInput }) => {
      const row = schemes.find((s) => s.id === where.id)!;
      Object.assign(row, data, { version: row.version + 1 });
      return row;
    },
  },
  product: {
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) =>
      product(products.find((p) => p.id === where.id)!),
    findMany: async ({ where }: { where: { schemePrices?: { some: { schemeId: string } } } }) =>
      products
        .filter(
          (p) =>
            !where.schemePrices ||
            prices.some(
              (row) => row.productId === p.id && row.schemeId === where.schemePrices!.some.schemeId,
            ),
        )
        .map(product),
  },
  priceSchemeRevision: {
    create: async ({ data }: { data: object }) => {
      revisions.push(data);
    },
  },
  productSchemePrice: {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { productId_schemeId: { productId: string; schemeId: string } };
      create: Price;
      update: Partial<Price>;
    }) => {
      if (failWrite) throw new Error('storage failed');
      const row = prices.find(
        (p) =>
          p.productId === where.productId_schemeId.productId &&
          p.schemeId === where.productId_schemeId.schemeId,
      );
      if (row) Object.assign(row, update, { version: row.version + 1 });
      else prices.push({ ...create, id: id(100 + prices.length), version: 1 });
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Price> }) => {
      const row = prices.find((p) => p.id === where.id)!;
      Object.assign(row, data, { version: row.version + 1 });
    },
    delete: async ({ where }: { where: { id: string } }) => {
      prices = prices.filter((p) => p.id !== where.id);
    },
  },
} as unknown as Tx;
beforeEach(() => {
  schemes = [];
  prices = [];
  revisions = [];
  failWrite = false;
  products = [1, 2, 3].map((n) => ({
    id: id(n),
    name: `Product ${n}`,
    code: `P${n}`,
    direct: 20000,
  }));
  mocks.transaction.mockImplementation(async (operation: (tx: Tx) => Promise<unknown>) => {
    const snapshot = structuredClone({ schemes, prices, products, revisions });
    try {
      return await operation(tx);
    } catch (error) {
      ({ schemes, prices, products, revisions } = snapshot);
      throw error;
    }
  });
});
async function save(change: SchemeChange, excludedIds: string[] = []) {
  const preview = await previewSchemeChange(change);
  return commitSchemeChange({ ...change, token: preview.token, excludedIds });
}
describe('scheme lifecycle and transactional protection', () => {
  it('adds common prices to every product, stays idempotent, and keeps them after disabling common', async () => {
    await save({ input: base });
    expect(prices).toHaveLength(3);
    expect(prices[0].amountCents).toBe(21053);
    await syncSchemePrices(tx, products[0].id);
    expect(prices).toHaveLength(3);
    expect(prices[0].version).toBe(1);
    await save({ id: id(90), expectedVersion: 1, input: { ...base, common: false } });
    expect(prices).toHaveLength(3);
    expect(prices[0].version).toBe(1);
  });
  it('preserves manual prices and explicitly excluded prices across future changes', async () => {
    await save({ input: base });
    await syncSchemePrices(tx, products[0].id, {
      items: [{ schemeId: id(90), schemeVersion: 1, mode: 'MANUAL', amountCents: 21053 }],
    });
    await save({ id: id(90), expectedVersion: 1, input: { ...base, formula: 'direct * 2' } }, [
      products[1].id,
    ]);
    expect(prices.map((p) => [p.mode, p.amountCents])).toEqual([
      ['MANUAL', 21053],
      ['RETAIN', 21053],
      ['AUTO', 40000],
    ]);
    products.forEach((p) => (p.direct = 30000));
    for (const p of products) await syncSchemePrices(tx, p.id);
    expect(prices.map((p) => p.amountCents)).toEqual([21053, 21053, 60000]);
    await syncSchemePrices(tx, products[1].id, {
      items: [{ schemeId: id(90), schemeVersion: 2, mode: 'AUTO', amountCents: 21053 }],
    });
    expect(prices[1].mode).toBe('AUTO');
    expect(prices[1].amountCents).toBe(60000);
  });
  it('does not clear prior associations for old clients and removes only explicit optional omissions', async () => {
    await save({ input: base });
    await save({ id: id(90), expectedVersion: 1, input: { ...base, common: false } });
    await syncSchemePrices(tx, products[0].id);
    expect(prices).toHaveLength(3);
    await syncSchemePrices(tx, products[0].id, { items: [] });
    expect(prices).toHaveLength(2);
  });
  it('clears invalid automatic prices but retains the last valid amount for history', async () => {
    await save({ input: base });
    await save({ id: id(90), expectedVersion: 1, input: { ...base, formula: 'quote' } });
    expect(prices[0]).toMatchObject({
      amountCents: null,
      previousAmountCents: 21053,
      error: 'NOT_APPLICABLE',
    });
    await save({ id: id(90), expectedVersion: 2, input: { ...base, formula: '1 / 0' } });
    expect(prices[0]).toMatchObject({
      amountCents: null,
      previousAmountCents: 21053,
      error: 'DIVISION_ZERO',
    });
  });
  it('rejects preview changes in product values, modes, schemes and product membership', async () => {
    const change = { input: base };
    const preview = await previewSchemeChange(change);
    products.push({ id: id(4), name: 'new', code: 'P4', direct: 5000 });
    await expect(
      commitSchemeChange({ ...change, token: preview.token, excludedIds: [] }),
    ).rejects.toMatchObject({ code: 'SCHEME_PRICE_CHANGED' });
    await save(change);
    const edit = { id: id(90), expectedVersion: 1, input: { ...base, formula: 'direct * 2' } };
    const second = await previewSchemeChange(edit);
    prices[0].mode = 'MANUAL';
    prices[0].version++;
    await expect(
      commitSchemeChange({ ...edit, token: second.token, excludedIds: [] }),
    ).rejects.toMatchObject({ code: 'SCHEME_PRICE_CHANGED' });
    const third = await previewSchemeChange(edit);
    products[1].direct++;
    await expect(
      commitSchemeChange({ ...edit, token: third.token, excludedIds: [] }),
    ).rejects.toMatchObject({ code: 'SCHEME_PRICE_CHANGED' });
  });
  it('rejects a stale editor token and rolls back failed scheme changes', async () => {
    await save({ input: base });
    const token = priceStateToken(product(products[0]));
    products[0].direct++;
    await expect(checkPriceState(tx, products[0].id, token)).rejects.toMatchObject({
      code: 'SCHEME_PRICE_CHANGED',
    });
    failWrite = true;
    await expect(
      save({ id: id(90), expectedVersion: 1, input: { ...base, formula: 'direct * 2' } }),
    ).rejects.toThrow('storage failed');
    expect(schemes[0].version).toBe(1);
    expect(revisions).toHaveLength(1);
    expect(prices[0].amountCents).toBe(21053);
  });
  it('is insensitive to JSONB property ordering and rejects forged retained prices', async () => {
    expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 }));
    await save({ input: base });
    await expect(
      syncSchemePrices(tx, products[0].id, {
        items: [{ schemeId: id(90), schemeVersion: 1, mode: 'RETAIN', amountCents: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
