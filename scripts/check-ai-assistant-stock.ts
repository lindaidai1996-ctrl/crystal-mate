import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { readAssistantStock } from '../src/lib/ai-assistant/stock-data';
import { stockQuerySchema } from '../src/lib/ai-assistant/stock-contracts';
import { materialStockSummary } from '../src/lib/inventory';

async function main() {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const target = new URL(process.env[key] ?? '');
    assert(
      target.protocol === 'postgresql:' &&
        target.hostname === '127.0.0.1' &&
        target.port === '15432' &&
        target.pathname === '/crystal_mate_dev' &&
        target.username === 'crystal_dev',
      'Requires isolated development database',
    );
  }
  const client = new PrismaClient({ log: [] });
  try {
    const report = await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [target] = await tx.$queryRaw<
          { database: string; username: string; read_only: string }[]
        >`SELECT current_database() AS database, current_user AS username, current_setting('transaction_read_only') AS read_only`;
        assert.equal(target.database, 'crystal_mate_dev');
        assert.equal(target.username, 'crystal_dev');
        assert.equal(target.read_only, 'on');
        const input = stockQuerySchema.parse({
          mode: 'catalog_current',
          query: {
            version: 'v1',
            subject: 'catalog',
            itemTypes: ['MATERIAL', 'PRODUCT'],
            hard: {},
            semantic: [],
            ruleVersion: 'v1',
            pagination: { limit: 1 },
          },
        });
        const all = await readAssistantStock(tx, input);
        const [materials, products, entries, sqlStocks] = await Promise.all([
          tx.material.findMany({ select: { id: true, unit: true } }),
          tx.product.findMany({ select: { id: true, stock: true } }),
          tx.materialBatchEntry.findMany({
            select: {
              id: true,
              materialId: true,
              batchId: true,
              distributorId: true,
              receivedQty: true,
              remainingQty: true,
              batch: { select: { receivedAt: true } },
              stockAdjustments: { select: { id: true } },
              diyLines: { select: { usageUnit: true, quantity: true } },
            },
            orderBy: [{ batch: { receivedAt: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }],
          }),
          tx.$queryRaw<
            { materialId: string; known: Prisma.Decimal | null; unknown: number }[]
          >`SELECT "materialId", SUM("remainingQty") AS known, COUNT(*) FILTER (WHERE "remainingQty" IS NULL)::int AS unknown FROM "MaterialBatchEntry" GROUP BY "materialId"`,
        ]);
        assert.equal(all.catalogStock.length, materials.length + products.length);
        const byItem = new Map(
          all.catalogStock.map((row) => [`${row.item.type}:${row.item.id}`, row]),
        );
        for (const material of materials) {
          const stock = byItem.get(`MATERIAL:${material.id}`)!;
          const batches = entries.filter((e) => e.materialId === material.id);
          const legacy = materialStockSummary(
            batches.map((e) => ({ remainingQty: e.remainingQty?.toNumber() ?? null })),
          );
          assert.equal(stock.knownStock, legacy.knownStock.toFixed(2));
          assert.equal(stock.unknownStockBatchCount, legacy.unknownStockBatchCount);
          assert.equal(stock.stockBatchCount, batches.length);
          const sql = sqlStocks.find((r) => r.materialId === material.id);
          assert.equal(stock.knownStock, sql?.known?.toFixed(2) ?? '0.00');
          assert.equal(stock.unknownStockBatchCount, sql?.unknown ?? 0);
        }
        for (const product of products)
          assert.equal(byItem.get(`PRODUCT:${product.id}`)?.knownStock, product.stock.toFixed(2));
        const purchaseQuery = {
          ...input.query,
          subject: 'purchases' as const,
          itemTypes: ['MATERIAL' as const],
        };
        const sources = await readAssistantStock(tx, {
          mode: 'purchase_remaining',
          query: purchaseQuery,
        });
        assert.equal(sources.sourceStock.length, entries.length);
        for (const row of sources.sourceStock) {
          const raw = entries.find((e) => e.id === row.purchase.id)!;
          assert.equal(row.item.id, raw.materialId);
          assert.equal(row.batch.id, raw.batchId);
          assert.equal(row.purchasedQuantity, raw.receivedQty?.toFixed(2) ?? null);
          assert.equal(row.remainingQuantity, raw.remainingQty?.toFixed(2) ?? null);
        }
        const empty = await readAssistantStock(tx, {
          mode: 'catalog_current',
          query: purchaseQuery,
          selectedPurchases: [],
        });
        assert.equal(empty.catalogStock.length, 0);
        const multi = materials.filter(
          (m) => entries.filter((e) => e.materialId === m.id).length > 1,
        );
        const datedChecks = [];
        for (const material of multi) {
          const chosen = entries.find((e) => e.materialId === material.id)!;
          const from = chosen.batch.receivedAt.toISOString().slice(0, 10);
          const nextDay = new Date(chosen.batch.receivedAt);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const query = {
            ...purchaseQuery,
            hard: {
              purchaseDate: { from, to: nextDay.toISOString().slice(0, 10) },
              distributorIds: [chosen.distributorId],
              items: [{ type: 'MATERIAL', id: material.id }],
            },
          };
          const selectedPurchases = [{ type: 'MATERIAL_PURCHASE', id: chosen.id }];
          const [total, source] = await Promise.all([
            readAssistantStock(tx, { mode: 'catalog_current', query, selectedPurchases }),
            readAssistantStock(tx, { mode: 'purchase_remaining', query, selectedPurchases }),
          ]);
          assert.deepEqual(total.catalogStock, [byItem.get(`MATERIAL:${material.id}`)]);
          assert.equal(
            source.sourceStock[0].remainingQuantity,
            chosen.remainingQty?.toFixed(2) ?? null,
          );
          const outsideDateCount = entries.filter(
            (e) =>
              e.materialId === material.id &&
              e.batch.receivedAt.toISOString().slice(0, 10) !== from,
          ).length;
          datedChecks.push({
            stockBatchCount: total.catalogStock[0].stockBatchCount,
            outsideDateCount,
            sourceRemaining: source.sourceStock[0].remainingQuantity,
            totalKnownStock: total.catalogStock[0].knownStock,
            unknownStockBatchCount: total.catalogStock[0].unknownStockBatchCount,
          });
        }
        return {
          checkedAt: new Date().toISOString(),
          source: 'crystal_mate_dev',
          mode: 'read-only-repeatable-read',
          catalog: {
            materialCount: materials.length,
            productCount: products.length,
            pageLimitOneDoesNotTruncate: true,
            matchesBusinessSummary: true,
            matchesIndependentSql: true,
            matchesProductStock: true,
          },
          batches: {
            count: entries.length,
            nullRemainingCount: entries.filter((e) => e.remainingQty === null).length,
            zeroRemainingCount: entries.filter((e) => e.remainingQty?.isZero()).length,
            changedFromReceivedCount: entries.filter(
              (e) =>
                e.remainingQty !== null &&
                e.receivedQty !== null &&
                !e.remainingQty.equals(e.receivedQty),
            ).length,
            withAdjustmentCount: entries.filter((e) => e.stockAdjustments.length).length,
            withDiyLinesCount: entries.filter((e) => e.diyLines.length).length,
            differentDiyUsageUnitCount: entries.filter((e) =>
              e.diyLines.some(
                (line) => line.usageUnit !== materials.find((m) => m.id === e.materialId)?.unit,
              ),
            ).length,
            sourceMappingMatchesPersistedBalances: true,
          },
          multiBatchMaterialCount: multi.length,
          historicalSelectionChecks: datedChecks,
          emptySelectionCount: empty.catalogStock.length,
          limitations: [
            'No business writes, migrations, production access or deployment',
            'No authenticated HTTP session, model call or E2E',
            'DIY lines do not auto-decrement persisted material remainingQty in current business implementation',
            'Missing real scenarios are covered by constructed service tests only; see observed counts',
            'Product purchase source remaining is unavailable; only product total stock is supported',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
    if (process.argv.includes('--save'))
      await writeFile(
        new URL('../docs/plans/ai-assistant/verification/2026-11-16-p2-05.json', import.meta.url),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(
      'Read-only stock verification failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(
    'Invalid stock verification configuration:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
