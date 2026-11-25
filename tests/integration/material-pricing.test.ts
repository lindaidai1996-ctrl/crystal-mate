import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
import { db } from '@/lib/db';
import { auditContext } from '@/lib/audit-context';
import {
  savePricingGroup,
  getPricingPreview,
  publishPricingGroup,
  listPricingOptions,
  listPricingHistory,
} from '@/lib/material-pricing/service';
import { saveProduct } from '@/lib/products';
import { updateProductSource, serializeProductSources } from '@/lib/product-sources';
import { customerDiyDetails } from '@/lib/product-diy-quote';
import { cardQuote } from '@/lib/product-cards/quote';
import { shanghaiDate } from '@/lib/metal-market';
import { listPickerMaterials } from '@/lib/diy-picker/query';
import { pickerFiltersSchema } from '@/lib/diy-picker/contracts';
import { materialListWhere } from '@/lib/catalog-list-filters';
import { materialListSchema } from '@/lib/validation';
import { previewUnitCorrection } from '@/lib/material-unit-correction-service';
import { readAssistantCandidates } from '@/lib/ai-assistant/candidate-data';
import { readAssistantPurchases } from '@/lib/ai-assistant/purchase-data';
import { assistantQuerySchema } from '@/lib/ai-assistant/contracts';
import type { ProductDiyRun } from '@/lib/client-types';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/none').pathname.endsWith('_test');
afterAll(() => db.$disconnect());
describe.skipIf(!enabled)('unified pricing database integration', () => {
  it('publishes versioned prices, freezes DIY costs, filters ordinary selection and preserves real procurement and inventory', async () => {
    vi.stubEnv('AUTH_SECRET', 'integration-pricing-secret');
    const suffix = randomUUID();
    const category = await db.materialCategory.create({ data: { name: `pricing-${suffix}` } });
    const productCategory = await db.category.create({ data: { name: `pricing-${suffix}` } });
    const supplier = await db.distributor.create({
      data: { name: `pricing-${suffix}`, area: 'test' },
    });
    const material = await db.material.create({
      data: { name: `S925-${suffix}`, categoryId: category.id, unit: 'GRAM', lossRate: '90' },
    });
    const batch = await db.materialBatch.create({
      data: { name: `pricing-${suffix}`, receivedAt: new Date(`${shanghaiDate()}T00:00:00Z`) },
    });
    const entry = await db.materialBatchEntry.create({
      data: {
        materialId: material.id,
        batchId: batch.id,
        distributorId: supplier.id,
        receivedQty: '100',
        remainingQty: '100',
        purchaseInputMode: 'BATCH',
        purchaseTotalWeightGrams: '100',
        purchaseTotalAmount: '1200',
        purchaseGramPrice: '12',
        lossRate: '80',
        saleGramPrice: '999',
      },
    });
    const groupIds: string[] = [];
    let productId: string | undefined;
    const config = {
      name: `银饰-${suffix}`,
      materialIds: [material.id],
      lossRate: '20',
      marketLinked: false,
      marketCoefficient: '1',
      pricingRule: 'MARGIN' as const,
      pricingValue: '30',
      enabled: false,
    };
    try {
      const group = await savePricingGroup(config);
      groupIds.push(group.id);
      await expect(savePricingGroup({ ...config, name: `other-${suffix}` })).rejects.toMatchObject({
        code: 'PRICING_MATERIAL_IN_USE',
      });
      await expect(
        savePricingGroup({ ...config, enabled: true, version: group.version }, group.id),
      ).rejects.toMatchObject({ code: 'PRICING_PUBLISH_FIRST' });
      await expect(previewUnitCorrection(material.id, 'BEAD')).rejects.toMatchObject({
        code: 'PRICING_GRAM_ONLY',
      });
      const preview = await getPricingPreview(group.id);
      expect(preview.preview.totals).toMatchObject({
        rawCost: '12.00',
        adjustedCost: '15.00',
        amount: '1200.00',
        weight: '100.00',
      });
      expect(preview.preview.suggestedPrice).toBe('21.43');
      const operationId = randomUUID();
      const publication = await auditContext.run(
        {
          operationId,
          source: 'POST /api/material-pricing-groups/test/publish',
          actor: { id: 'pricing-test', username: 'pricing', nickname: '' },
        },
        () =>
          publishPricingGroup(group.id, {
            version: group.version,
            fingerprint: preview.preview.fingerprint,
            saleGramPrice: '25',
          }),
      );
      const audit = await db.auditLog.findMany({
        where: { operationId, entityType: 'MaterialPricingPublication' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].rootId).toBe(group.id);
      expect(audit[0].actorId).toBe('pricing-test');
      expect((await listPricingOptions()).items.some((item) => item.id === group.id)).toBe(true);
      const published = await getPricingPreview(group.id);
      expect(published.group.enabled).toBe(true);
      const option = (await listPricingOptions()).items.find((item) => item.id === group.id)!;
      expect(option).toMatchObject({
        unitCost: '15.00',
        saleGramPrice: '25.00',
        lossRate: '20.00',
      });
      const line = {
        groupId: group.id,
        publicationId: publication.id,
        costBasisToken: option.costBasisToken,
        quantity: '2',
        unitCost: option.unitCost,
        quoteUnitPrice: option.saleGramPrice,
      };
      const source = {
        origin: 'DIY' as const,
        quantity: 3,
        notes: '',
        materials: [],
        cabochons: [],
        extraCosts: [],
        pricingLines: [line],
      };
      const product = await saveProduct({
        name: '统一计价测试',
        code: `PRICING-${suffix}`,
        description: '',
        categoryId: productCategory.id,
        priceCents: 0,
        currency: 'CNY',
        stock: 0,
        published: false,
        imageKeys: [],
        saleRule: 'COST',
        saleRuleValue: null,
        saleManual: false,
        source,
      });
      productId = product.id;
      const run = product.diyRuns[0];
      expect(run).toMatchObject({
        perUnitCost: '30.00',
        totalCost: '90.00',
        perUnitQuote: '50.00',
        totalQuote: '150.00',
      });
      expect(run.pricingLines[0]).toMatchObject({
        name: config.name,
        costSnapshot: { rawCost: '12.00', adjustedCost: '15.00', lossRate: '20.00' },
      });
      const customer = customerDiyDetails(run as unknown as ProductDiyRun)!;
      const customerJson = JSON.stringify(customer);
      expect(customer.pricingMaterials[0]).toEqual({
        name: config.name,
        quantityPerItem: '2.00',
        unitPrice: '25.00',
        subtotalPerItem: '50.00',
      });
      for (const key of [
        'costSnapshot',
        'costBasisToken',
        'lossRate',
        'rawCost',
        'unitCost',
        'publicationId',
      ])
        expect(customerJson).not.toContain(key);
      expect(
        cardQuote(run as unknown as ProductDiyRun)?.rows.find((row) => row.name === config.name)
          ?.subtotal,
      ).toBe('50.00');
      const picker = await listPickerMaterials(
        'pricing-test',
        pickerFiltersSchema.parse({ q: suffix }),
      );
      expect(picker.items.some((row) => row.id === material.id)).toBe(false);
      const ordinary = await materialListWhere(
        materialListSchema.parse({ pricing: 'DIY', q: suffix }),
      );
      expect(await db.material.count({ where: ordinary })).toBe(0);
      const grouped = await materialListWhere(
        materialListSchema.parse({ pricing: 'GROUPED', q: suffix }),
      );
      expect(await db.material.count({ where: grouped })).toBe(1);
      // Assistant procurement retains the real price, without sale-price or loss-rate substitution.
      const query = assistantQuerySchema.parse({
        version: 'v1',
        subject: 'purchases',
        semantic: [],
        ruleVersion: 'v1',
        pagination: { limit: 50 },
        itemTypes: ['MATERIAL'],
        hard: { items: [{ type: 'MATERIAL', id: material.id }] },
      });
      const purchases = await db.$transaction((tx) => readAssistantPurchases(tx, { query }));
      expect(purchases.rows[0].amount).toBe('1200.00');
      expect((await db.$transaction((tx) => readAssistantCandidates(tx, query))).length).toBe(1);
      await db.materialBatchEntry.update({
        where: { id: entry.id },
        data: { purchaseTotalAmount: '1400' },
      });
      const changed = await getPricingPreview(group.id);
      expect(changed.preview.changed).toBe(true);
      await savePricingGroup(
        { ...config, lossRate: '50', enabled: true, version: changed.group.version },
        group.id,
      );
      expect(
        (await listPricingOptions()).items.find((item) => item.id === group.id)?.unitCost,
      ).toBe('28.00');
      const snapshot = await db.productDiyPricingLine.findUniqueOrThrow({
        where: { id: run.pricingLines[0].id },
      });
      expect(snapshot.unitCost.toFixed(2)).toBe('15.00');
      const latest = await getPricingPreview(group.id);
      await savePricingGroup(
        { ...config, lossRate: '50', enabled: false, version: latest.group.version },
        group.id,
      );
      const disabled = await getPricingPreview(group.id);
      await publishPricingGroup(group.id, {
        version: disabled.group.version,
        fingerprint: disabled.preview.fingerprint,
        saleGramPrice: '30',
      });
      expect((await getPricingPreview(group.id)).group.enabled).toBe(false);
      expect((await listPricingOptions()).items.some((item) => item.id === group.id)).toBe(false);
      const edited = serializeProductSources(
        await updateProductSource(product.id, run.id, {
          ...source,
          notes: '普通修改',
          pricingLines: [
            { ...line, id: snapshot.id, quantity: '2.5', unitCost: '16', quoteUnitPrice: '26' },
          ],
        }),
      );
      expect(edited.diyRuns[0]).toMatchObject({
        perUnitCost: '40.00',
        totalCost: '120.00',
        perUnitQuote: '65.00',
        totalQuote: '195.00',
      });
      expect(edited.diyRuns[0].pricingLines[0].costSnapshot).toMatchObject({
        lossRate: '20.00',
        adjustedCost: '15.00',
      });
      await expect(updateProductSource(product.id, run.id, source)).rejects.toMatchObject({
        code: 'PRICING_GROUP_DISABLED',
      });
      // An old API omitting the new collection must preserve the saved lines and their totals.
      const legacyEdit = serializeProductSources(
        await updateProductSource(product.id, run.id, {
          ...source,
          pricingLines: undefined,
          notes: '旧接口',
        }),
      );
      expect(legacyEdit.diyRuns[0].totalCost).toBe('120.00');
      const large = serializeProductSources(
        await updateProductSource(product.id, run.id, {
          ...source,
          quantity: 1,
          pricingLines: [
            {
              ...line,
              id: snapshot.id,
              quantity: '1000000000.11',
              unitCost: '0',
              quoteUnitPrice: '9999999999.91',
            },
          ],
        }),
      );
      expect(large.diyRuns[0].pricingLines[0].quoteLineTotal).toBe('10000000001009999999.99');
      expect(large.diyRuns[0].perUnitQuote).toBe('10000000001009999999.99');
      expect(cardQuote(large.diyRuns[0] as unknown as ProductDiyRun)?.total).toBe(
        '10000000001009999999.99',
      );

      const history = await listPricingHistory(group.id);
      expect(history.total).toBe(2);
      expect(history.items[0].saleGramPrice).toBe('30.00');
      expect(history.items[1]).toMatchObject({
        saleGramPrice: '25.00',
        costBasis: { lossRate: '20.00' },
      });
      const stock = await db.materialBatchEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(stock.remainingQty?.toFixed(2)).toBe('100.00');
      expect(stock.lossRate?.toFixed(2)).toBe('80.00');
      await expect(savePricingGroup({ ...config, version: 1 }, group.id)).rejects.toMatchObject({
        code: 'PRICING_CHANGED',
      });
    } finally {
      if (productId) {
        await db.productDiyRun.deleteMany({ where: { productId } });
        await db.product.delete({ where: { id: productId } });
      }
      await db.productCode.deleteMany({ where: { categoryId: productCategory.id } });
      await db.material.update({ where: { id: material.id }, data: { pricingGroupId: null } });
      await db.materialPricingPublication.deleteMany({ where: { groupId: { in: groupIds } } });
      await db.materialPricingGroup.deleteMany({ where: { id: { in: groupIds } } });
      await db.materialBatchEntry.deleteMany({ where: { materialId: material.id } });
      await db.material.delete({ where: { id: material.id } });
      await db.materialBatch.delete({ where: { id: batch.id } });
      await db.distributor.delete({ where: { id: supplier.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
      await db.category.delete({ where: { id: productCategory.id } });
      vi.unstubAllEnvs();
    }
  });
  it('scans more than one purchase page and rejects concurrent publication from the same version', async () => {
    const suffix = randomUUID();
    const category = await db.materialCategory.create({ data: { name: suffix } });
    const supplier = await db.distributor.create({ data: { name: suffix, area: 'test' } });
    const material = await db.material.create({
      data: { name: suffix, categoryId: category.id, unit: 'GRAM' },
    });
    const config = {
      name: suffix,
      materialIds: [material.id],
      lossRate: '0',
      marketLinked: false,
      marketCoefficient: '1',
      pricingRule: 'PERCENT' as const,
      pricingValue: '30',
      enabled: false,
    };
    const group = await savePricingGroup(config);
    const batches = Array.from({ length: 501 }, (_, i) => ({
      id: `cm${randomUUID().replaceAll('-', '')}`,
      name: `${suffix}-${i}`,
      receivedAt: new Date(`${shanghaiDate()}T00:00:00Z`),
    }));
    try {
      await db.materialBatch.createMany({ data: batches });
      await db.materialBatchEntry.createMany({
        data: batches.map((batch) => ({
          materialId: material.id,
          batchId: batch.id,
          distributorId: supplier.id,
          purchaseTotalAmount: '10',
          purchaseTotalWeightGrams: '2',
          purchaseInputMode: 'BATCH',
          receivedQty: '2',
          remainingQty: '2',
        })),
      });
      const state = await getPricingPreview(group.id);
      expect(state.preview.totals).toEqual({
        amount: '5010.00',
        weight: '1002.00',
        count: 501,
        rawCost: '5.00',
        adjustedCost: '5.00',
      });
      const input = {
        version: group.version,
        fingerprint: state.preview.fingerprint,
        saleGramPrice: '6.50',
      };
      const results = await Promise.allSettled([
        publishPricingGroup(group.id, input),
        publishPricingGroup(group.id, input),
      ]);
      expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
      expect((await listPricingHistory(group.id)).total).toBe(1);
      expect((await getPricingPreview(group.id)).group.enabled).toBe(true);
    } finally {
      await db.material.update({ where: { id: material.id }, data: { pricingGroupId: null } });
      await db.materialPricingPublication.deleteMany({ where: { groupId: group.id } });
      await db.materialPricingGroup.delete({ where: { id: group.id } });
      await db.materialBatchEntry.deleteMany({ where: { materialId: material.id } });
      await db.material.delete({ where: { id: material.id } });
      await db.materialBatch.deleteMany({ where: { id: { in: batches.map((row) => row.id) } } });
      await db.distributor.delete({ where: { id: supplier.id } });
      await db.materialCategory.delete({ where: { id: category.id } });
    }
  }, 30000);
});
