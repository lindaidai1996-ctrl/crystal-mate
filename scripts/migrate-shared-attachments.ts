import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Apply exactly this feature's migration, never every pending application migration.
const migration = '20261119000000_shared_attachments';
const apply = process.argv.includes('--apply');
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = new URL(process.env[key] ?? '');
  if (
    !process.argv.includes('--dev') ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '15432' ||
    url.pathname !== '/crystal_mate_dev' ||
    url.username !== 'crystal_dev'
  )
    throw new Error('This script only supports the isolated development database with --dev.');
}
const client = new PrismaClient();
async function snapshot() {
  const [distributors, batches, distributorAttachments, batchAttachments] = await Promise.all([
    client.$queryRaw`SELECT id,"coverObjectKey" FROM "Distributor" ORDER BY id`,
    client.$queryRaw`SELECT id,"coverObjectKey" FROM "MaterialBatch" ORDER BY id`,
    client.$queryRaw`SELECT to_jsonb(a)-'assetId' AS item FROM "DistributorAttachment" a ORDER BY id`,
    client.$queryRaw`SELECT to_jsonb(a)-'assetId' AS item FROM "MaterialBatchAttachment" a ORDER BY id`,
  ]);
  return { distributors, batches, distributorAttachments, batchAttachments };
}
function run(args: string[]) {
  const result = spawnSync('npx', ['prisma', ...args], { encoding: 'utf8', env: process.env });
  if (result.status !== 0)
    throw new Error(
      'The exact feature migration command failed; no other migrations were requested.',
    );
  console.log(result.stdout);
}
async function main() {
  try {
    const applied = await client.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name=${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    if (applied.length) {
      console.log('Shared attachment migration is already applied.');
    } else {
      const before = await snapshot();
      if (!apply)
        console.log('Development target verified. Add --apply to back up, migrate and compare.');
      else {
        const dir = join(
          process.cwd(),
          'backups',
          'shared-attachments',
          new Date().toISOString().replace(/[:.]/g, '-'),
        );
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'before.json'), JSON.stringify(before, null, 2));
        // db execute is not migrate deploy: unrelated pending migrations remain untouched.
        run([
          'db',
          'execute',
          '--file',
          `prisma/migrations/${migration}/migration.sql`,
          '--schema',
          'prisma/schema.prisma',
        ]);
        const after = await snapshot();
        await writeFile(join(dir, 'after.json'), JSON.stringify(after, null, 2));
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new Error(`Legacy attachment verification failed. Inspect ${dir}.`);
        const invalid = await client.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM (
    SELECT a.id FROM "DistributorAttachment" a JOIN "SharedAttachment" s ON s.id=a."assetId" WHERE a."objectKey"<>s."objectKey" OR a.url<>s.url OR a.notes<>s.notes OR a."fileName"<>s."fileName"
    UNION ALL SELECT a.id FROM "MaterialBatchAttachment" a JOIN "SharedAttachment" s ON s.id=a."assetId" WHERE a."objectKey"<>s."objectKey" OR a.url<>s.url OR a.notes<>s.notes OR a."fileName"<>s."fileName"
   ) mismatches`;
        if (invalid[0].count !== BigInt(0))
          throw new Error('Shared attachment backfill does not match legacy values.');
        run(['migrate', 'resolve', '--applied', migration]);
        await writeFile(
          join(dir, 'verification.json'),
          JSON.stringify(
            {
              migration,
              legacyUnchanged: true,
              projectionMismatches: 0,
              verifiedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        console.log(`Development migration verified. Report: ${dir}`);
      }
    }
  } finally {
    await client.$disconnect();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
