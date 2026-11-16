import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { assistantQuerySchema } from '../src/lib/ai-assistant/contracts';
import { readAssistantRecall } from '../src/lib/ai-assistant/recall-data';
import { RecallRuns } from '../src/lib/ai-assistant/recall-runs';
import { assessSemanticCandidate } from '../src/lib/ai-assistant/semantic-policy';
import { withDatabaseAudit } from '../src/lib/audit-db';
import { auditContext } from '../src/lib/audit-context';

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
  const audited = withDatabaseAudit(client);
  try {
    // Exercise the existing audit wrapper too: identity is transaction-local,
    // and the business reader still must enter READ ONLY before fetching data.
    const result = await auditContext.run(
      {
        operationId: 'read-only-assistant-verification',
        source: 'assistant-verification',
        actor: { id: 'verification-only', username: 'verification-only', nickname: '' },
      },
      () =>
        audited.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
            const [target] = await tx.$queryRaw<
              { database: string; username: string; read_only: string; context: string }[]
            >`SELECT current_database() AS database,current_user AS username,current_setting('transaction_read_only') AS read_only,current_setting('crystal.audit_context',true) AS context`;
            assert.equal(target.database, 'crystal_mate_dev');
            assert.equal(target.username, 'crystal_dev');
            assert.equal(target.read_only, 'on');
            assert.equal(JSON.parse(target.context).actor.id, 'verification-only');
            const query = assistantQuerySchema.parse({
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
              pagination: { limit: 5 },
            });
            const source = await readAssistantRecall(tx, query);
            const actualIds = source.rows.map((r) => r.candidate.purchase!.id).sort();
            const frozenIds = baseline.scopedCandidates.map((r) => r.id).sort();
            const frozenMissing = frozenIds.filter((id) => !actualIds.includes(id));
            assert.equal(frozenMissing.length, 0);
            const runs = new RecallRuns();
            let page = await runs.query('verification', query, async () => source);
            const ids: string[] = [],
              sizes: number[] = [];
            const sourceCounts = page.sourceCounts;
            for (;;) {
              ids.push(...page.items.map((r) => r.purchase!.id));
              sizes.push(page.items.length);
              assert.deepEqual(page.sourceCounts, sourceCounts);
              if (!page.nextCursor) break;
              page = await runs.query(
                'verification',
                { ...query, pagination: { limit: 5, cursor: page.nextCursor } },
                async () => {
                  throw new Error('Unexpected reload');
                },
              );
            }
            assert.deepEqual(ids.sort(), actualIds);
            assert.equal(new Set(ids).size, ids.length);
            const assessments = source.rows.map((r) => ({
              id: r.candidate.purchase!.id,
              ...assessSemanticCandidate(r.candidate, query.semantic),
            }));
            const included = assessments
              .filter((r) => r.decision?.status === 'include')
              .map((r) => r.id)
              .sort();
            assert.deepEqual(included, [...baseline.goldenCase.includedEntryIds].sort());
            const synonym = source.rows
              .filter(
                (r) =>
                  assessSemanticCandidate(r.candidate, [
                    query.semantic[0],
                    { concept: 'purpose', text: '配饰', relation: 'is' },
                  ]).decision?.status === 'include',
              )
              .map((r) => r.candidate.purchase!.id)
              .sort();
            assert.deepEqual(synonym, included);
            const catalog = await readAssistantRecall(tx, {
              ...query,
              subject: 'catalog',
              itemTypes: ['MATERIAL', 'PRODUCT'],
              hard: {},
            });
            const rawCounts = await Promise.all([tx.material.count(), tx.product.count()]);
            assert.equal(catalog.rows.length, rawCounts[0] + rawCounts[1]);
            const directReads = catalog.data.sourceCounts.find(
              (r) => r.route === 'full_scope',
            )!.candidateCount;
            assert.equal(directReads, catalog.rows.length);
            return {
              checkedAt: new Date().toISOString(),
              source: 'crystal_mate_dev',
              mode: 'read-only-repeatable-read',
              audit: {
                existingWrapperExercised: true,
                transactionLocalActorVerified: true,
                readOnlyVerified: true,
              },
              mainCase: {
                candidateCount: actualIds.length,
                expectedFrozenCandidateCount: frozenIds.length,
                frozenMissingCount: frozenMissing.length,
                addedSinceBaseline: actualIds.filter((id) => !frozenIds.includes(id)).length,
                expectedConfirmedCount: baseline.goldenCase.includedEntryIds.length,
                recallOfExpectedConfirmed: 1,
                pageSizes: sizes,
                duplicates: ids.length - new Set(ids).size,
                sourceCounts,
                deterministicRuleCounts: {
                  include: included.length,
                  exclude: assessments.filter((r) => r.decision?.status === 'exclude').length,
                  uncertain: assessments.filter((r) => r.decision?.status === 'uncertain').length,
                },
                confirmedSetMatchesFrozen: true,
                purposeSynonymKeepsConfirmedSet: true,
              },
              catalog: {
                materialCount: rawCounts[0],
                productCount: rawCounts[1],
                candidateCount: catalog.rows.length,
                sourceCounts: catalog.data.sourceCounts,
              },
              limitations: [
                'Deterministic policy evaluation only, no model or natural-language parsing evaluation',
                'Recall retains the entire bounded hard scope, lexical routes do not prove semantic inclusion',
                'No authenticated HTTP or persistent conversation isolation test',
                'No production access, business data writes, migrations, E2E or deployment',
                'Broad scopes over 5000 rows fail explicitly; scalable retrieval/budget recovery remains P3-04',
              ],
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
        ),
    );
    const [after] = await client.$queryRaw<
      { context: string | null }[]
    >`SELECT current_setting('crystal.audit_context',true) AS context`;
    assert(!after.context, 'Audit identity must not leak beyond its transaction');
    if (process.argv.includes('--save'))
      await writeFile(
        new URL(
          '../docs/plans/ai-assistant/verification/2026-11-16-p2-06-p3-01-02.json',
          import.meta.url,
        ),
        `${JSON.stringify({ ...result, auditIdentityAbsentAfterTransaction: true }, null, 2)}\n`,
      );
    console.log(JSON.stringify({ ...result, auditIdentityAbsentAfterTransaction: true }, null, 2));
  } catch (error) {
    console.error(
      'Read-only semantic/boundary verification failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(
    'Invalid verification configuration:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
