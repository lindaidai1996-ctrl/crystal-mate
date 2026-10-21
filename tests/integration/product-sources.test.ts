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
import { reserveProductCode } from '../../src/lib/product-code-store';
import { diyQuotePricing } from '../../src/lib/product-pricing';
import {
  addProductSource,
  adjustProductStock,
  correctProductOrigin,
  deleteProductSource,
  productSourceInclude,
  serializeProductSources,
  updateProductSource,
} from '../../src/lib/product-sources';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');

afterAll(async () => {
  await db.$disconnect();
});

describe.skipIf(!enabled)('product source transactions', () => {
  it('round-trips craft fees and exact totals through source edits and product pricing', async () => {
    const suffix = Date.now().toString(36);
    const category = await db.category.create({ data: { name: `手工费用${suffix}` } });
    const eggCategory = await db.category.create({ data: { name: '蛋面' } });
    const productIds: string[] = [];
    const base = {
      description: '',
      categoryId: category.id,
      priceCents: 0,
      currency: 'CNY' as const,
      stock: 0,
      published: false,
      imageKeys: [],
      saleRule: 'COST' as const,
      saleRuleValue: null,
      saleManual: false,
    };
    try {
      const egg = await db.product.create({
        data: {
          name: '费用测试蛋面',
          code: `CRAFT-EGG-${suffix}`,
          categoryId: eggCategory.id,
          priceCents: 0,
        },
      });
      productIds.push(egg.id);
      const source = {
        origin: 'DIY' as const,
        quantity: 3,
        notes: '',
        materials: [],
        cabochons: [{ productId: egg.id, quantity: 1, unitCost: '20', quoteUnitPrice: '30' }],
        extraCosts: [],
        craftDesignFee: {
          unitAmount: '10',
          accumulateByQuantity: false,
          totalAmount: null as string | null,
        },
      };
      const product = await saveProduct({
        ...base,
        name: '手工费用',
        code: `CRAFT-${suffix}`,
        source,
      });
      productIds.push(product.id);
      expect(product.diyRuns[0]).toMatchObject({
        perUnitCost: '20.00',
        totalCost: '60.00',
        perUnitQuote: '33.33',
        totalQuote: '100.00',
        cabochonLines: [
          {
            quoteUnitPrice: '30.00',
            quoteLineTotal: '30.00',
            quoteSnapshot: { name: '费用测试蛋面' },
          },
        ],
        craftDesignFee: source.craftDesignFee,
      });
      expect(product.priceCents).toBe(6000);
      await db.product.update({
        where: { id: egg.id },
        data: { name: '新蛋面名', priceCents: 99999 },
      });

      const edit = {
        ...source,
        craftDesignFee: {
          unitAmount: '10',
          accumulateByQuantity: true,
          totalAmount: '25',
        },
      };
      const edited = await updateProductSource(product.id, product.diyRuns[0].id, edit);
      expect(serializeProductSources(edited).diyRuns[0]).toMatchObject({
        perUnitCost: '20.00',
        totalCost: '60.00',
        totalQuote: '115.00',
        cabochonLines: [{ quoteUnitPrice: '30.00', quoteSnapshot: { name: '费用测试蛋面' } }],
        craftDesignFee: edit.craftDesignFee,
      });
      const changedQuantity = await updateProductSource(product.id, product.diyRuns[0].id, {
        ...edit,
        quantity: 4,
      });
      expect(serializeProductSources(changedQuantity).diyRuns[0]).toMatchObject({
        perUnitCost: '20.00',
        totalCost: '80.00',
        totalQuote: '145.00',
        craftDesignFee: edit.craftDesignFee,
      });
      const repriced = await saveProduct(
        { ...base, name: product.name, code: product.code },
        product.id,
      );
      expect(repriced.priceCents).toBe(8000);

      const automatic = await updateProductSource(product.id, product.diyRuns[0].id, {
        ...edit,
        quantity: 4,
        craftDesignFee: { ...edit.craftDesignFee, totalAmount: null },
      });
      expect(serializeProductSources(automatic).diyRuns[0]).toMatchObject({
        perUnitCost: '20.00',
        totalCost: '80.00',
        totalQuote: '160.00',
        craftDesignFee: { ...edit.craftDesignFee, totalAmount: null },
      });
      expect(automatic.stock).toBe(4);
      expect(automatic.priceCents).toBe(8000);
      const adopted = diyQuotePricing('80.00', '160.00');
      const accepted = await saveProduct(
        {
          ...base,
          name: product.name,
          code: product.code,
          saleManual: adopted.saleManual,
          saleRule: adopted.saleRule,
          saleRuleValue: adopted.saleRuleValue,
          priceCents: Number(adopted.price) * 100,
        },
        product.id,
      );
      expect(accepted.priceCents).toBe(16000);
      expect(accepted).toMatchObject({
        saleRule: 'FIXED_AMOUNT',
        saleRuleValue: '80.00',
        saleManual: false,
      });
      const incomplete = await updateProductSource(product.id, product.diyRuns[0].id, {
        ...source,
        cabochons: [{ ...source.cabochons[0], quoteUnitPrice: null }],
      });
      expect(serializeProductSources(incomplete).diyRuns[0]).toMatchObject({
        totalQuote: null,
        perUnitCost: '20.00',
      });
      expect(incomplete.priceCents).toBe(16000);
      const discounted = diyQuotePricing('60.00', '50.00');
      const savedDiscount = await saveProduct(
        {
          ...base,
          name: product.name,
          code: product.code,
          saleRule: discounted.saleRule,
          saleRuleValue: discounted.saleRuleValue,
          saleManual: discounted.saleManual,
          priceCents: 5000,
        },
        product.id,
      );
      expect(savedDiscount).toMatchObject({
        priceCents: 5000,
        saleRule: 'FIXED_AMOUNT',
        saleRuleValue: '-10.00',
        saleManual: false,
      });

      const feesOnlySource = {
        ...source,
        quantity: 2,
        cabochons: [],
        extraCosts: [{ name: '其他费用', amount: '2' }],
        craftDesignFee: { unitAmount: '100', accumulateByQuantity: true, totalAmount: null },
      };
      const feesOnly = await saveProduct({
        ...base,
        name: '仅费用DIY',
        code: `FEES-${suffix}`,
        source: feesOnlySource,
      });
      productIds.push(feesOnly.id);
      expect(feesOnly.diyRuns[0]).toMatchObject({
        perUnitCost: '2.00',
        totalCost: '4.00',
        materialLines: [],
        cabochonLines: [],
      });
      expect(feesOnly.priceCents).toBe(400);
      const editedFeesOnly = await updateProductSource(feesOnly.id, feesOnly.diyRuns[0].id, {
        ...feesOnlySource,
        craftDesignFee: { ...feesOnlySource.craftDesignFee, unitAmount: '120' },
      });
      expect(serializeProductSources(editedFeesOnly).diyRuns[0]).toMatchObject({
        perUnitCost: '2.00',
        totalCost: '4.00',
        materialLines: [],
        cabochonLines: [],
      });
    } finally {
      await db.productDiyRun.deleteMany({ where: { productId: { in: productIds } } });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
      await db.category.deleteMany({ where: { id: { in: [category.id, eggCategory.id] } } });
    }
  });

  it('shares a purchase batch, snapshots DIY inputs, and checks stock deltas', async () => {
    const suffix = Date.now().toString(36);
    const productIds: string[] = [];
    const category = await db.category.create({ data: { name: `商品${suffix}` } });
    const cabochonCategory = await db.category.create({ data: { name: '蛋面' } });
    const materialCategory = await db.materialCategory.create({ data: { name: `物料${suffix}` } });
    const distributor = await db.distributor.create({
      data: { name: `渠道${suffix}`, area: '网络' },
    });
    const batch = await db.materialBatch.create({
      data: { name: `采购${suffix}`, receivedAt: new Date('2026-10-13T00:00:00.000Z') },
    });
    const material = await db.material.create({
      data: { name: `珠串${suffix}`, categoryId: materialCategory.id },
    });
    const entry = await db.materialBatchEntry.create({
      data: {
        materialId: material.id,
        batchId: batch.id,
        distributorId: distributor.id,
        receivedQty: 2,
        remainingQty: 2,
        purchaseUnitPrice: '100.00',
        childUnitPrice: '5.00',
        purchaseGramPrice: '10.00',
      },
    });
    try {
      const egg = await db.product.create({
        data: {
          code: `EGG-${suffix}`,
          name: '测试蛋面',
          categoryId: cabochonCategory.id,
          priceCents: 10000,
          stock: 1,
          cost: { create: { totalCost: '20.00' } },
        },
      });
      productIds.push(egg.id);
      const base = {
        description: '',
        categoryId: category.id,
        priceCents: 10000,
        currency: 'CNY' as const,
        stock: 0,
        published: false,
        imageKeys: [],
      };
      const purchased = await saveProduct({
        ...base,
        code: `BUY-${suffix}`,
        name: '测试进货成品',
        source: {
          origin: 'PURCHASED',
          selection: { batchId: batch.id },
          distributorId: distributor.id,
          quantity: 2,
          unitCost: '31.00',
          notes: '',
        },
      });
      productIds.push(purchased.id);
      expect(purchased.stock).toBe(2);
      expect(purchased.purchaseEntries[0].batchId).toBe(entry.batchId);

      await addProductSource(purchased.id, {
        origin: 'PURCHASED',
        selection: { batchId: batch.id },
        distributorId: distributor.id,
        quantity: 3,
        unitCost: '33.00',
        notes: '',
      });
      expect((await db.product.findUniqueOrThrow({ where: { id: purchased.id } })).stock).toBe(5);
      const latest = await db.productPurchaseEntry.findFirstOrThrow({
        where: { productId: purchased.id, unitCost: '33.00' },
      });
      await updateProductSource(purchased.id, latest.id, {
        origin: 'PURCHASED',
        selection: { batchId: batch.id },
        distributorId: distributor.id,
        quantity: 1,
        unitCost: '33.00',
        notes: '',
      });
      expect((await db.product.findUniqueOrThrow({ where: { id: purchased.id } })).stock).toBe(3);
      await adjustProductStock(purchased.id, { delta: -2, reason: '盘点修正' });
      await expect(
        deleteProductSource(purchased.id, purchased.purchaseEntries[0].id),
      ).rejects.toMatchObject({
        code: 'PRODUCT_STOCK_OUT_OF_RANGE',
      });
      expect((await db.product.findUniqueOrThrow({ where: { id: purchased.id } })).stock).toBe(1);

      const diy = await saveProduct({
        ...base,
        code: `DIY-${suffix}`,
        name: '测试 DIY',
        source: {
          origin: 'DIY',
          quantity: 3,
          notes: '',
          materials: [
            {
              materialBatchEntryId: entry.id,
              usageUnit: 'BEAD',
              quantity: '2',
              unitCost: '5.00',
              quoteUnitPrice: '8.00',
            },
          ],
          cabochons: [
            { productId: egg.id, quantity: 1, unitCost: '20.00', quoteUnitPrice: '30.00' },
          ],
          extraCosts: [{ name: '配件', amount: '2.00', quoteAmount: '0.00' }],
        },
      });
      productIds.push(diy.id);
      expect(diy.stock).toBe(3);
      expect(diy.diyRuns[0].perUnitCost).toBe('32.00');
      expect(diy.diyRuns[0].materialLines[0].lineCost).toBe('10.00');
      expect(diy.diyRuns[0]).toMatchObject({
        perUnitQuote: '46.00',
        totalQuote: '138.00',
        materialLines: [
          {
            quoteUnitPrice: '8.00',
            quoteLineTotal: '16.00',
            quoteSnapshot: { name: material.name },
          },
        ],
      });
      expect(
        (
          await db.materialBatchEntry.findUniqueOrThrow({ where: { id: entry.id } })
        ).remainingQty?.toNumber(),
      ).toBe(2);
      expect((await db.product.findUniqueOrThrow({ where: { id: egg.id } })).stock).toBe(1);
      await db.materialBatchEntry.update({
        where: { id: entry.id },
        data: { childUnitPrice: '9.00', saleChildUnitPrice: '99.00' },
      });
      const saved = await db.product.findUniqueOrThrow({
        where: { id: diy.id },
        include: productSourceInclude,
      });
      expect(saved.diyRuns[0].perUnitCost.toFixed(2)).toBe('32.00');
      expect(saved.diyRuns[0].materialLines[0].quoteUnitPrice?.toFixed(2)).toBe('8.00');
      expect(saved.diyRuns[0].totalQuote?.toFixed(2)).toBe('138.00');

      await correctProductOrigin(purchased.id, {
        origin: 'DIY',
        quantity: 2,
        notes: '',
        materials: [
          {
            materialBatchEntryId: entry.id,
            usageUnit: 'GRAM',
            quantity: '0.50',
            unitCost: '10.00',
          },
        ],
        cabochons: [],
        extraCosts: [],
      });
      const corrected = await db.product.findUniqueOrThrow({
        where: { id: purchased.id },
        include: productSourceInclude,
      });
      expect(corrected.code).toBe(purchased.code);
      expect(corrected.origin).toBe('DIY');
      expect(corrected.stock).toBe(0);
      expect(corrected.purchaseEntries).toHaveLength(0);
      expect(corrected.diyRuns[0].perUnitCost.toFixed(2)).toBe('5.00');
    } finally {
      await db.productDiyRun.deleteMany({ where: { productId: { in: productIds } } });
      await db.productPurchaseEntry.deleteMany({ where: { productId: { in: productIds } } });
      await db.productStockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
      await db.materialBatchEntry.delete({ where: { id: entry.id } });
      await db.material.delete({ where: { id: material.id } });
      await db.materialBatch.delete({ where: { id: batch.id } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.materialCategory.delete({ where: { id: materialCategory.id } });
      await db.category.delete({ where: { id: category.id } });
      await db.category.delete({ where: { id: cabochonCategory.id } });
    }
  });
  it('persists pricing, preserves legacy prices, and recalculates only on product save', async () => {
    const suffix = Date.now().toString(36);
    const category = await db.category.create({ data: { name: `定价${suffix}` } });
    const cabochonCategory = await db.category.create({ data: { name: '蛋面' } });
    const distributor = await db.distributor.create({
      data: { name: `定价渠道${suffix}`, area: '网络' },
    });
    const batch = await db.materialBatch.create({
      data: { name: `定价批次${suffix}`, receivedAt: new Date('2026-10-14T00:00:00.000Z') },
    });
    const productIds: string[] = [];
    const base = {
      description: '',
      categoryId: category.id,
      priceCents: 12345,
      currency: 'CNY' as const,
      stock: 0,
      published: false,
      imageKeys: [],
    };
    const auto = { saleRule: 'PERCENT_50' as const, saleRuleValue: null, saleManual: false };
    const source = {
      origin: 'PURCHASED' as const,
      quantity: 2,
      unitCost: '10.00',
      distributorId: distributor.id,
      selection: { batchId: batch.id },
      notes: '',
    };
    try {
      const legacy = await db.product.create({
        data: {
          name: '旧商品',
          code: `LEGACY-${suffix}`,
          categoryId: category.id,
          priceCents: 12345,
          stock: 0,
        },
      });
      productIds.push(legacy.id);
      expect(legacy).toMatchObject({
        priceCents: 12345,
        saleRule: 'PERCENT_50',
        saleManual: true,
        saleRuleValue: null,
      });
      const legacySaved = await saveProduct(
        { ...base, name: legacy.name, code: legacy.code },
        legacy.id,
      );
      expect(legacySaved.priceCents).toBe(12345);
      expect(legacySaved.saleManual).toBe(true);
      await expect(
        saveProduct({ ...base, ...auto, name: legacy.name, code: legacy.code }, legacy.id),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect((await db.product.findUniqueOrThrow({ where: { id: legacy.id } })).priceCents).toBe(
        12345,
      );

      const buy = await saveProduct({
        ...base,
        ...auto,
        name: '自动进货售价',
        code: `PRICE-${suffix}`,
        source,
      });
      productIds.push(buy.id);
      expect(buy).toMatchObject({
        priceCents: 1500,
        saleRule: 'PERCENT_50',
        saleRuleValue: null,
        saleManual: false,
      });
      const original = buy.purchaseEntries[0];
      await db.productPurchaseEntry.update({
        where: { id: original.id },
        data: { createdAt: new Date('2026-10-01T00:00:00.000Z') },
      });
      await addProductSource(buy.id, { ...source, unitCost: '20.00', quantity: 1 });
      let stored = await db.product.findUniqueOrThrow({
        where: { id: buy.id },
        include: productSourceInclude,
      });
      const latest = stored.purchaseEntries.find((record) => record.id !== original.id)!;
      expect(stored.priceCents).toBe(1500);
      const saved = await saveProduct({ ...base, ...auto, name: buy.name, code: buy.code }, buy.id);
      expect(saved.priceCents).toBe(3000);
      await updateProductSource(buy.id, latest.id, { ...source, unitCost: '30.00', quantity: 1 });
      expect((await db.product.findUniqueOrThrow({ where: { id: buy.id } })).priceCents).toBe(3000);
      expect(
        (await saveProduct({ ...base, ...auto, name: buy.name, code: buy.code }, buy.id))
          .priceCents,
      ).toBe(4500);
      await deleteProductSource(buy.id, latest.id);
      expect((await db.product.findUniqueOrThrow({ where: { id: buy.id } })).priceCents).toBe(4500);
      expect(
        (await saveProduct({ ...base, ...auto, name: buy.name, code: buy.code }, buy.id))
          .priceCents,
      ).toBe(1500);
      const manual = await saveProduct(
        { ...base, ...auto, saleManual: true, priceCents: 9999, name: buy.name, code: buy.code },
        buy.id,
      );
      expect(manual.priceCents).toBe(9999);
      await addProductSource(buy.id, { ...source, unitCost: '50.00', quantity: 1 });
      stored = await db.product.findUniqueOrThrow({
        where: { id: buy.id },
        include: productSourceInclude,
      });
      expect(stored).toMatchObject({ priceCents: 9999, saleManual: true });
      expect(
        (
          await saveProduct(
            {
              ...base,
              ...auto,
              saleManual: true,
              priceCents: 9999,
              name: buy.name,
              code: buy.code,
            },
            buy.id,
          )
        ).priceCents,
      ).toBe(9999);
      const custom = await saveProduct(
        {
          ...base,
          ...auto,
          saleRule: 'CUSTOM_PERCENT',
          saleRuleValue: '12.34',
          name: buy.name,
          code: buy.code,
        },
        buy.id,
      );
      expect(custom).toMatchObject({
        priceCents: 5617,
        saleRule: 'CUSTOM_PERCENT',
        saleRuleValue: '12.34',
        saleManual: false,
      });
      const oldRequest = await saveProduct(
        { ...base, priceCents: 4321, name: buy.name, code: buy.code },
        buy.id,
      );
      expect(oldRequest).toMatchObject({ priceCents: 4321, saleManual: true });

      const egg = await db.product.create({
        data: {
          name: '定价蛋面',
          code: `PRICE-EGG-${suffix}`,
          categoryId: cabochonCategory.id,
          priceCents: 1111,
          stock: 1,
          cost: { create: { roughStoneCost: '10', totalCost: '50', totalManual: true } },
        },
      });
      productIds.push(egg.id);
      const pricedEgg = await saveProduct(
        {
          ...base,
          ...auto,
          name: egg.name,
          code: egg.code,
          categoryId: cabochonCategory.id,
          cost: {
            roughStoneCost: '10',
            settingCost: null,
            otherCosts: [],
            totalCost: '50',
            totalManual: true,
          },
        },
        egg.id,
      );
      expect(pricedEgg.priceCents).toBe(7500);
      const diy = await saveProduct({
        ...base,
        ...auto,
        name: 'DIY 本次总成本',
        code: `PRICE-DIY-${suffix}`,
        source: {
          origin: 'DIY',
          quantity: 3,
          notes: '',
          materials: [],
          cabochons: [{ productId: egg.id, quantity: 1, unitCost: '20.00' }],
          extraCosts: [{ name: '配件', amount: '2.00' }],
        },
      });
      productIds.push(diy.id);
      expect(diy.diyRuns[0].perUnitCost).toBe('22.00');
      expect(diy.priceCents).toBe(9900);
      const fixed = await saveProduct(
        {
          ...base,
          ...auto,
          saleRule: 'FIXED_AMOUNT',
          saleRuleValue: '20.25',
          name: diy.name,
          code: diy.code,
        },
        diy.id,
      );
      expect(fixed).toMatchObject({ priceCents: 8625, saleRuleValue: '20.25' });
      await db.category.update({ where: { id: category.id }, data: { prefix: 'PRICE' } });
      const switchedCode = await reserveProductCode(category.id);
      const switched = await saveProduct(
        {
          ...base,
          ...auto,
          saleManual: true,
          priceCents: 9999,
          name: egg.name,
          code: switchedCode.code,
          codeReservationToken: switchedCode.reservationToken,
          cost: null,
          measurement: null,
        },
        egg.id,
      );
      expect(switched.cost).toBeNull();
      expect(switched.priceCents).toBe(9999);
      await expect(
        saveProduct(
          {
            ...base,
            ...auto,
            name: buy.name,
            code: buy.code,
            saleRule: 'FIXED_AMOUNT',
            saleRuleValue: '9999999999.99',
          },
          buy.id,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    } finally {
      await db.productDiyRun.deleteMany({ where: { productId: { in: productIds } } });
      await db.productPurchaseEntry.deleteMany({ where: { productId: { in: productIds } } });
      await db.productStockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
      await db.product.deleteMany({ where: { id: { in: productIds } } });
      await db.materialBatch.delete({ where: { id: batch.id } });
      await db.distributor.delete({ where: { id: distributor.id } });
      await db.category.delete({ where: { id: category.id } });
      await db.category.delete({ where: { id: cabochonCategory.id } });
    }
  });
});
