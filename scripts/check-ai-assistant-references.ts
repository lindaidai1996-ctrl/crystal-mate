import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import baseline from '../docs/plans/ai-assistant/development-baseline.json';
import { REFERENCE_SCAN_LIMIT } from '../src/lib/ai-assistant/reference-contracts';
import {
  resolveLocationRows,
  resolvedLocationDistributorIds,
  searchDictionaryRows,
  type DictionaryRow,
} from '../src/lib/ai-assistant/reference-resolution';

async function main() {
  // Run through scripts/with-dev-db.mjs. Independently reject any non-development
  // target before creating a client; never print URLs, credentials or raw fields.
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const target = new URL(process.env[key] ?? '');
    assert(
      target.protocol === 'postgresql:' &&
        target.hostname === '127.0.0.1' &&
        target.port === '15432' &&
        target.pathname === '/crystal_mate_dev' &&
        target.username === 'crystal_dev',
      'Reference check requires the isolated development database',
    );
  }
  const client = new PrismaClient({ log: [] });
  try {
    const result = await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        const take = REFERENCE_SCAN_LIMIT + 1;
        const orderBy = { id: 'asc' } as const;
        const [target] = await tx.$queryRaw<{ database: string; username: string }[]>`
        SELECT current_database() AS database, current_user AS username
      `;
        assert.equal(target.database, 'crystal_mate_dev');
        assert.equal(target.username, 'crystal_dev');
        const [distributors, categories, tags] = await Promise.all([
          tx.distributor.findMany({
            select: { id: true, name: true, area: true, address: true, notes: true },
            orderBy,
            take,
          }),
          tx.materialCategory.findMany({
            select: { id: true, name: true, aliases: true, parentId: true },
            orderBy,
            take,
          }),
          tx.tag.findMany({ select: { id: true, name: true }, orderBy, take }),
        ]);
        assert(
          [distributors, categories, tags].every((rows) => rows.length <= REFERENCE_SCAN_LIMIT),
        );
        const location = resolveLocationRows(
          { text: '荔湾广场', kind: 'exact_place' },
          distributors,
        );
        const actualIds = resolvedLocationDistributorIds(location).sort();
        const expectedIds = [...baseline.scope.distributorIds].sort();
        const dictionaryRows: DictionaryRow[] = [
          ...categories.map((row) => ({ ...row, type: 'MATERIAL_CATEGORY' as const })),
          ...tags.map((row) => ({ ...row, type: 'TAG' as const, aliases: [], parentId: null })),
        ];
        const alias = searchDictionaryRows(
          { text: '镀18K金', kinds: ['MATERIAL_CATEGORY', 'TAG'] },
          dictionaryRows,
        );
        const expectedAliasId = baseline.categories.find((row) =>
          row.aliases.includes('镀18K金'),
        )!.id;
        return {
          checkedAt: new Date().toISOString(),
          source: 'crystal_mate_dev',
          mode: 'read-only-repeatable-read',
          distributorCount: distributors.length,
          materialCategoryCount: categories.length,
          tagCount: tags.length,
          location: {
            status: location.status,
            confirmedCount: actualIds.length,
            uncertainCount: location.uncertain.length,
            missingBaselineIds: expectedIds.filter((id) => !actualIds.includes(id)),
            additionalIds: actualIds.filter((id) => !expectedIds.includes(id)),
            baselineOtherIdsIncorrectlyIncluded: baseline.locationEvidence
              .filter((row) => !row.addressMentionsLiwanPlaza && actualIds.includes(row.id))
              .map((row) => row.id),
          },
          categoryAlias: {
            totalMatches: alias.totalMatches,
            expectedIdFound: alias.items.some((row) => row.entity.id === expectedAliasId),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    );
    console.log(JSON.stringify(result, null, 2));
    assert.equal(result.location.missingBaselineIds.length, 0);
    assert.equal(result.location.additionalIds.length, 0);
    assert.equal(result.location.baselineOtherIdsIncorrectlyIncluded.length, 0);
    assert(result.categoryAlias.expectedIdFound);
  } catch (error) {
    // Prisma errors may contain connection details; output only the failure kind.
    console.error(
      'Read-only reference verification failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Invalid reference verification configuration:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
