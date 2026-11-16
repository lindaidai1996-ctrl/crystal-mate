import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { purchaseQuerySchema } from '../src/lib/ai-assistant/purchase-contracts';
import { readAssistantPurchases } from '../src/lib/ai-assistant/purchase-data';
import { PurchaseRuns } from '../src/lib/ai-assistant/purchase-runs';
import { summarizeAssistantPurchases } from '../src/lib/ai-assistant/purchase-summary';

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
    const result = await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const [target] = await tx.$queryRaw<
          { database: string; username: string }[]
        >`SELECT current_database() AS database, current_user AS username`;
        assert.equal(target.database, 'crystal_mate_dev');
        assert.equal(target.username, 'crystal_dev');
        const input = purchaseQuerySchema.parse({
          query: {
            version: 'v1',
            subject: 'purchases',
            itemTypes: ['MATERIAL'],
            hard: {
              purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
              location: { text: '荔湾广场', kind: 'exact_place' },
            },
            semantic: [],
            ruleVersion: 'v1',
            pagination: { limit: 3 },
          },
          selectedPurchases: baseline.goldenCase.includedEntryIds.map((id) => ({
            type: 'MATERIAL_PURCHASE',
            id,
          })),
        });
        const source = await readAssistantPurchases(tx, input);
        const runs = new PurchaseRuns();
        let page = await runs.query('read-only-verification', input, async () => source);
        const summary = page.summary;
        const ids: string[] = [];
        const pageSizes: number[] = [];
        for (;;) {
          ids.push(...page.items.map((r) => r.purchase.id));
          pageSizes.push(page.items.length);
          assert.deepEqual(page.summary, summary);
          if (!page.nextCursor) break;
          page = await runs.query(
            'read-only-verification',
            {
              ...input,
              query: { ...input.query, pagination: { limit: 3, cursor: page.nextCursor } },
            },
            async () => {
              throw new Error('Unexpected reload');
            },
          );
        }
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual([...ids].sort(), [...baseline.goldenCase.includedEntryIds].sort());
        assert.equal(summary.scopeCandidateCount, 44);
        assert.equal(summary.totals.purchaseEntryCount, 11);
        assert.equal(summary.totals.catalogItemCount, 11);
        assert.equal(summary.totals.amounts[0].knownAmount, '1897.60');
        assert.equal(summary.totals.amounts[0].unknownAmountEntryCount, 0);
        const quantities = Object.fromEntries(
          summary.totals.quantities.map((r) => [r.unit, r.knownQuantity]),
        );
        assert.deepEqual(quantities, baseline.goldenCase.quantitiesByUnit);
        for (const group of summary.byDistributor) {
          const expected =
            baseline.goldenCase.distributorGroups[
              group.distributor.id as keyof typeof baseline.goldenCase.distributorGroups
            ];
          assert(expected);
          assert.equal(group.totals.amounts[0].knownAmount, expected.amount);
        }
        // Independently compare against the existing distributor SQL amount rule.
        const [legacy] = await tx.$queryRaw<{ amount: Prisma.Decimal }[]>(Prisma.sql`
        SELECT SUM(COALESCE(e."purchaseTotalAmount", e."receivedQty" * e."purchaseUnitPrice")) AS amount
        FROM "MaterialBatchEntry" e WHERE e.id IN (${Prisma.join(ids)})
      `);
        assert.equal(legacy.amount.toFixed(2), summary.totals.amounts[0].knownAmount);
        const multiple = await readAssistantPurchases(tx, {
          query: {
            ...input.query,
            hard: {
              purchaseDate: input.query.hard.purchaseDate,
              distributorIds: Object.keys(baseline.goldenCase.distributorGroups),
              items: baseline.goldenCase.includedMaterialIds.map((id) => ({
                type: 'MATERIAL',
                id,
              })),
            },
          },
        });
        assert.deepEqual(multiple.rows.map((r) => r.purchase.id).sort(), [...ids].sort());
        const empty = await readAssistantPurchases(tx, { ...input, selectedPurchases: [] });
        assert.equal(empty.rows.length, 0);
        const all = await readAssistantPurchases(tx, { query: input.query });
        const allSummary = summarizeAssistantPurchases(
          all.rows,
          all.scopeCandidateCount,
          'hard_scope',
        );
        const products = await readAssistantPurchases(tx, {
          query: { ...input.query, itemTypes: ['PRODUCT'], hard: {} },
        });
        const productSummary = summarizeAssistantPurchases(
          products.rows,
          products.scopeCandidateCount,
          'hard_scope',
        );
        assert(
          products.rows.every(
            (r) => r.unit === 'PIECE' && r.amountBasis === 'quantity_times_unit_price',
          ),
        );
        return {
          checkedAt: new Date().toISOString(),
          source: 'crystal_mate_dev',
          mode: 'read-only-repeatable-read',
          mainCase: {
            scopeCandidateCount: summary.scopeCandidateCount,
            purchaseEntryCount: summary.totals.purchaseEntryCount,
            catalogItemCount: summary.totals.catalogItemCount,
            pageSizes,
            duplicateCount: ids.length - new Set(ids).size,
            frozenIdSetMatches: true,
            amounts: summary.totals.amounts,
            quantities: summary.totals.quantities,
            distributorAmounts: summary.byDistributor.map((g) => ({
              distributorId: g.distributor.id,
              purchaseEntryCount: g.totals.purchaseEntryCount,
              amounts: g.totals.amounts,
            })),
            matchesLegacyAmountRule: true,
            multiObjectAndDistributorIdsMatch: true,
            emptySelectionCount: empty.rows.length,
          },
          additionalMapping: {
            allScopeEntryCount: allSummary.totals.purchaseEntryCount,
            productEntryCount: productSummary.totals.purchaseEntryCount,
            productQuantityUnit: 'PIECE',
          },
          limitations: [
            'Golden selection is a frozen manually reviewed ID set, not a model evaluation',
            'Purchase currency defaults to CNY; no independent historical currency field',
            'No real authenticated HTTP session, model call or inventory verification',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
    if (process.argv.includes('--save'))
      await writeFile(
        new URL('../docs/plans/ai-assistant/verification/2026-11-16-p2-04.json', import.meta.url),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      'Read-only purchase verification failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(
    'Invalid purchase verification configuration:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
