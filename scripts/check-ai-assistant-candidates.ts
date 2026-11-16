import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { assistantQuerySchema, type AssistantQuery } from '../src/lib/ai-assistant/contracts';
import { CandidateRuns } from '../src/lib/ai-assistant/candidate-runs';
import { readAssistantCandidates } from '../src/lib/ai-assistant/candidate-data';

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
        const query: AssistantQuery = assistantQuerySchema.parse({
          version: 'v1',
          subject: 'purchases',
          itemTypes: ['MATERIAL'],
          hard: {
            purchaseDate: { from: '2026-11-01', to: '2026-12-01' },
            location: { text: '荔湾广场', kind: 'exact_place' },
          },
          semantic: [
            { concept: 'material', text: '绿松石', relation: 'is' },
            { concept: 'purpose', text: '配件', relation: 'is' },
          ],
          ruleVersion: 'v1',
          pagination: { limit: 7 },
        });
        const rows = await readAssistantCandidates(tx, query);
        const runs = new CandidateRuns();
        let page = await runs.query('read-only-verification', query, async () => rows);
        const first = page;
        const ids: string[] = [];
        const pageSizes: number[] = [];
        for (;;) {
          ids.push(...page.items.map((r) => r.purchase!.id));
          pageSizes.push(page.items.length);
          assert.equal(page.completeness.readCandidates, ids.length);
          if (!page.nextCursor) break;
          page = await runs.query(
            'read-only-verification',
            { ...query, pagination: { limit: 7, cursor: page.nextCursor } },
            async () => {
              throw new Error('Unexpected reload');
            },
          );
        }
        assert.equal(new Set(ids).size, ids.length);
        const expected = baseline.scopedCandidates.map((r) => r.id);
        const missing = expected.filter((id) => !ids.includes(id));
        const additional = ids.filter((id) => !expected.includes(id));
        const details = runs.details('read-only-verification', {
          runId: first.runId,
          candidates: first.items.map(({ item, purchase }) => ({ item, purchase })),
        });
        assert.equal(details.items.length, first.items.length);
        assert(
          rows.every(
            (r) => r.distributor && baseline.scope.distributorIds.includes(r.distributor.id),
          ),
        );
        const before = await readAssistantCandidates(tx, {
          ...query,
          hard: { ...query.hard, purchaseDate: { from: '2026-11-01', to: '2026-11-14' } },
        });
        const after = await readAssistantCandidates(tx, {
          ...query,
          hard: { ...query.hard, purchaseDate: { from: '2026-11-14', to: '2026-12-01' } },
        });
        assert.equal(before.length + after.length, rows.length);
        assert(
          !before.some((r) =>
            after.some((other) => other.candidate.purchase!.id === r.candidate.purchase!.id),
          ),
        );
        const empty = await readAssistantCandidates(tx, {
          ...query,
          hard: { purchaseDate: { from: '1900-01-01', to: '1900-02-01' } },
        });
        assert.equal(empty.length, 0);
        const emptyPlace = await readAssistantCandidates(tx, {
          ...query,
          hard: { location: { text: '__不存在的验收地点__', kind: 'exact_place' } },
        });
        assert.equal(emptyPlace.length, 0);
        const other = baseline.locationEvidence.find((r) => !r.addressMentionsLiwanPlaza)!;
        const intersection = await readAssistantCandidates(tx, {
          ...query,
          hard: { ...query.hard, distributorIds: [other.id] },
        });
        assert.equal(intersection.length, 0);
        const materialCatalog = await readAssistantCandidates(tx, {
          ...query,
          subject: 'catalog',
          hard: {},
        });
        const productCatalog = await readAssistantCandidates(tx, {
          ...query,
          subject: 'catalog',
          itemTypes: ['PRODUCT'],
          hard: {},
        });
        const productPurchases = await readAssistantCandidates(tx, {
          ...query,
          itemTypes: ['PRODUCT'],
          hard: {},
        });
        const materialCategory = baseline.categories.find((r) => r.parentId === null)!;
        const categoryRows = await readAssistantCandidates(tx, {
          ...query,
          subject: 'catalog',
          hard: {
            categories: [
              { type: 'MATERIAL_CATEGORY', id: materialCategory.id, includeDescendants: true },
            ],
          },
        });
        return {
          checkedAt: new Date().toISOString(),
          source: 'crystal_mate_dev',
          mode: 'read-only-repeatable-read',
          mainCase: {
            expectedCount: expected.length,
            actualCount: ids.length,
            pageSizes,
            duplicateCount: ids.length - new Set(ids).size,
            missingBaselineIds: missing,
            additionalIds: additional,
            completeness: page.completeness,
            detailsRead: details.items.length,
          },
          boundaries: {
            beforeExclusive14: before.length,
            fromInclusive14: after.length,
            emptyDateCount: empty.length,
            emptyPlaceCount: emptyPlace.length,
            emptyLocationIntersectionCount: intersection.length,
          },
          mappingChecks: {
            materialCatalogCount: materialCatalog.length,
            productCatalogCount: productCatalog.length,
            productPurchaseCount: productPurchases.length,
            categorySubtreeCatalogCount: categoryRows.length,
          },
          limitations: [
            'No real authenticated HTTP session or model call',
            'Snapshot fields are observation-time data; no purchase amount or inventory verification',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.mainCase.missingBaselineIds.length, 0);
    assert.equal(result.mainCase.additionalIds.length, 0);
  } catch (error) {
    console.error(
      'Read-only candidate verification failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(
    'Invalid candidate verification configuration:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
