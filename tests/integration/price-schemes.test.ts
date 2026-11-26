import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import { previewSchemeChange, commitSchemeChange } from '@/lib/price-schemes/service';
import {
  checkPriceState,
  priceStateToken,
  schemeContextSelect,
  syncSchemePrices,
} from '@/lib/price-schemes/store';
import { addProductSource, updateProductSource } from '@/lib/product-sources';
import { productInclude, serializeProduct, saveProduct } from '@/lib/products';
import { reserveProductCode } from '@/lib/product-code-store';
import { productSchema } from '@/lib/validation';
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled =
  process.env.RUN_PRICE_SCHEME_DB_TEST === '1' &&
  url?.hostname === '127.0.0.1' &&
  url.pathname === '/crystal_mate_dev';
const db = new PrismaClient();
afterAll(() => db.$disconnect());
describe.skipIf(!enabled)('price schemes on PostgreSQL (always rolled back)', () => {
  it('persists prices, recalculates source costs, protects edits and rolls back every fixture', async () => {
    const rollback = new Error('ROLLBACK_PRICE_SCHEME_TEST');
    const suffix = randomUUID();
    let schemeId = '',
      productId = '';
    await expect(
      db.$transaction(
        async (tx) => {
          // Services participate in this real outer transaction; it always throws at the end.
          mocks.transaction.mockImplementation(
            (operation: (tx: Prisma.TransactionClient) => unknown) => operation(tx),
          );
          const category = await tx.category.create({
            data: { name: `价格测试-${suffix}`, prefix: 'ZQP' },
          });
          const supplier = await tx.distributor.create({
            data: { name: `价格测试-${suffix}`, area: '测试' },
          });
          const input = {
            name: `价格测试-${suffix}`,
            formula: 'cost * 2',
            rounding: 'CENT' as const,
            common: false,
            position: 0,
          };
          const preview = await previewSchemeChange({ input });
          const result = await commitSchemeChange({ input, token: preview.token, excludedIds: [] });
          schemeId = result.scheme.id;
          const reservation = await reserveProductCode(category.id);
          const base = productSchema.parse({
            code: reservation.code,
            codeReservationToken: reservation.reservationToken,
            name: `价格测试-${suffix}`,
            description: '',
            categoryId: category.id,
            priceCents: 20000,
            saleRule: 'CUSTOM_AMOUNT',
            saleRuleValue: null,
            saleManual: true,
            currency: 'CNY',
            stock: 0,
            published: false,
            imageKeys: [],
            source: {
              origin: 'PURCHASED',
              quantity: 1,
              unitCost: '50',
              distributorId: supplier.id,
              selection: {
                newBatch: { name: `价格测试-${suffix}`, receivedAt: '2026-11-26', notes: '' },
              },
              notes: '',
            },
            schemePrices: {
              items: [{ schemeId, schemeVersion: 1, mode: 'AUTO', amountCents: null }],
            },
          });
          const created = await saveProduct(base);
          productId = created.id;
          expect(created.schemePrices[0].amountCents).toBe(10000);
          const source = {
            origin: 'PURCHASED' as const,
            quantity: 1,
            unitCost: '75',
            distributorId: supplier.id,
            selection: { batchId: created.purchaseEntries[0].batchId },
            notes: '',
          };
          await updateProductSource(productId, created.purchaseEntries[0].id, source);
          let product = await tx.product.findUniqueOrThrow({
            where: { id: productId },
            select: schemeContextSelect,
          });
          expect(product.schemePrices[0].amountCents).toBe(15000);
          const stale = priceStateToken(product);
          await syncSchemePrices(tx, productId, {
            items: [{ schemeId, schemeVersion: 1, mode: 'MANUAL', amountCents: 8888 }],
          });
          await expect(checkPriceState(tx, productId, stale)).rejects.toMatchObject({
            code: 'SCHEME_PRICE_CHANGED',
          });
          await addProductSource(productId, { ...source, unitCost: '90' });
          product = await tx.product.findUniqueOrThrow({
            where: { id: productId },
            select: schemeContextSelect,
          });
          expect(product.schemePrices[0]).toMatchObject({ mode: 'MANUAL', amountCents: 8888 });
          await syncSchemePrices(tx, productId, {
            items: [{ schemeId, schemeVersion: 1, mode: 'AUTO', amountCents: 8888 }],
          });
          const change = {
            id: schemeId,
            expectedVersion: 1,
            input: { ...input, formula: 'direct / 0.95' },
          };
          const impact = await previewSchemeChange(change);
          expect(impact.rows).toHaveLength(1);
          expect(impact.rows[0].amountCents).toBe(21053);
          await commitSchemeChange({ ...change, token: impact.token, excludedIds: [productId] });
          const saved = serializeProduct(
            await tx.product.findUniqueOrThrow({
              where: { id: productId },
              include: productInclude,
            }),
          );
          expect(saved.schemePrices[0]).toMatchObject({ mode: 'RETAIN', amountCents: 18000 });
          expect(await tx.priceSchemeRevision.count({ where: { schemeId } })).toBe(2);
          expect(
            await tx.auditLog.count({
              where: { entityType: 'ProductSchemePrice', entityId: product.schemePrices[0].id },
            }),
          ).toBeGreaterThan(0);
          throw rollback;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 },
      ),
    ).rejects.toBe(rollback);
    expect(await db.priceScheme.findUnique({ where: { id: schemeId } })).toBeNull();
    expect(await db.product.findUnique({ where: { id: productId } })).toBeNull();
  }, 150000);
});
