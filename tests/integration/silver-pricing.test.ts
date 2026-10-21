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
import { saveProduct } from '../../src/lib/products';
import { getSilverPricing, saveSilverPricing } from '../../src/lib/silver-pricing';
import { serializeProductSources, updateProductSource } from '../../src/lib/product-sources';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');

afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('silver pricing persistence', () => {
  it('persists defaults separately from product snapshots and round-trips source edits', async () => {
    const previous = await db.silverPricing.findUnique({ where: { id: 'default' } });
    const suffix = Date.now().toString(36);
    const category = await db.category.create({ data: { name: `银饰测试${suffix}` } });
    const productIds: string[] = [];
    const base = {
      description: '',
      categoryId: category.id,
      currency: 'CNY' as const,
      stock: 0,
      published: false,
      imageKeys: [],
      saleManual: false,
      saleRule: 'FIXED_AMOUNT' as const,
      saleRuleValue: '75',
      priceCents: 22500,
    };
    const source = {
      origin: 'DIY' as const,
      quantity: 3,
      notes: '',
      materials: [],
      cabochons: [],
      extraCosts: [],
      silverCost: { weightGrams: '2.5', costGramPrice: '20', quoteGramPrice: '30' },
    };
    try {
      await db.silverPricing.deleteMany();
      expect(await getSilverPricing()).toEqual({ costGramPrice: '20.00', quoteGramPrice: '30.00' });
      await saveSilverPricing({ costGramPrice: '21.25', quoteGramPrice: '31.50' });
      expect(await getSilverPricing()).toEqual({ costGramPrice: '21.25', quoteGramPrice: '31.50' });
      const stored = await db.silverPricing.findUniqueOrThrow({ where: { id: 'default' } });
      expect(stored.costGramPrice.toFixed(2)).toBe('21.25');
      expect(stored.quoteGramPrice.toFixed(2)).toBe('31.50');

      const product = await saveProduct({
        ...base,
        name: '银饰快照',
        code: `SILVER-${suffix}`,
        source,
      });
      productIds.push(product.id);
      expect(product.diyRuns[0]).toMatchObject({
        silverCost: { weightGrams: '2.50', costGramPrice: '20.00', quoteGramPrice: '30.00' },
        perUnitCost: '50.00',
        totalCost: '150.00',
        perUnitQuote: '75.00',
        totalQuote: '225.00',
      });
      expect(product.priceCents).toBe(22500);

      await saveSilverPricing({ costGramPrice: '24', quoteGramPrice: '36' });
      const unchanged = await db.productDiyRun.findUniqueOrThrow({
        where: { id: product.diyRuns[0].id },
      });
      expect(unchanged.silverCostGramPrice.toFixed(2)).toBe('20.00');
      expect(unchanged.silverQuoteGramPrice.toFixed(2)).toBe('30.00');
      expect(unchanged.totalCost?.toFixed(2)).toBe('150.00');
      expect(unchanged.totalQuote?.toFixed(2)).toBe('225.00');
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).priceCents).toBe(
        22500,
      );

      const next = await saveProduct({
        ...base,
        name: '新默认克价',
        code: `SILVER-NEXT-${suffix}`,
        saleRuleValue: '30',
        priceCents: 9000,
        source: {
          ...source,
          quantity: 1,
          silverCost: { weightGrams: '2.5', ...(await getSilverPricing()) },
        },
      });
      productIds.push(next.id);
      expect(next.diyRuns[0]).toMatchObject({
        silverCost: { weightGrams: '2.50', costGramPrice: '24.00', quoteGramPrice: '36.00' },
        totalCost: '60.00',
        totalQuote: '90.00',
      });

      const edited = await updateProductSource(product.id, product.diyRuns[0].id, {
        ...source,
        quantity: 2,
        silverCost: { weightGrams: '1.25', costGramPrice: '22', quoteGramPrice: '33' },
      });
      expect(serializeProductSources(edited).diyRuns[0]).toMatchObject({
        silverCost: { weightGrams: '1.25', costGramPrice: '22.00', quoteGramPrice: '33.00' },
        perUnitCost: '27.50',
        totalCost: '55.00',
        perUnitQuote: '41.25',
        totalQuote: '82.50',
      });
      expect(edited.stock).toBe(2);
      expect(await getSilverPricing()).toEqual({ costGramPrice: '24.00', quoteGramPrice: '36.00' });

      const legacy = await saveProduct({
        ...base,
        name: '旧版无银饰',
        code: `SILVER-LEGACY-${suffix}`,
        saleRuleValue: '0',
        priceCents: 0,
        source: { ...source, quantity: 1, silverCost: undefined },
      });
      productIds.push(legacy.id);
      expect(legacy.diyRuns[0]).toMatchObject({
        silverCost: { weightGrams: '0.00', costGramPrice: '20.00', quoteGramPrice: '30.00' },
        totalCost: '0.00',
        totalQuote: '0.00',
      });
    } finally {
      await db.productDiyRun.deleteMany({ where: { productId: { in: productIds } } });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
      await db.productCode.deleteMany({ where: { categoryId: category.id } });
      await db.category.delete({ where: { id: category.id } });
      await db.silverPricing.deleteMany();
      if (previous) await db.silverPricing.create({ data: previous });
    }
  });
});
