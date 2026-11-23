import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  availablePricingBatchName,
  pricingBatchNameBase,
} from '../src/lib/material-pricing/batch-names';
import { reservePricingBatchName } from '../src/lib/material-pricing/purchase-batch-name';

const apply = process.argv.includes('--apply');
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const target = new URL(process.env[key] ?? '');
  assert(
    process.argv.includes('--dev') &&
      target.protocol === 'postgresql:' &&
      target.hostname === '127.0.0.1' &&
      target.port === '15432' &&
      target.pathname === '/crystal_mate_dev' &&
      target.username === 'crystal_dev',
    'Requires --dev and the isolated development database.',
  );
}

const client = new PrismaClient();
const generatedName = /^AG-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{3}$/;

async function businessFingerprint(tx: Prisma.TransactionClient) {
  const tables = await tx.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_prisma_migrations', 'AuditLog', 'RecordAttribution')
    ORDER BY table_name`;
  const result: Record<string, unknown> = {};
  for (const { table_name: table } of tables) {
    const identifier = Prisma.raw(`"${table.replaceAll('"', '""')}"`);
    const payload =
      table === 'MaterialBatch'
        ? Prisma.sql`to_jsonb(record) - 'name' - 'updatedAt'`
        : Prisma.sql`to_jsonb(record)`;
    result[table] = await tx.$queryRaw`
      SELECT count(*)::int AS count,
        md5(coalesce(string_agg(payload::text, '' ORDER BY payload::text), '')) AS hash
      FROM (SELECT ${payload} AS payload FROM ${identifier} record) records`;
  }
  return result;
}

async function main() {
  const report = await client.$transaction(
    async (tx) => {
      if (apply) {
        // Keep the preview, name reservations and updates consistent with concurrent writers.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('pricing-purchase-batch-names'))`;
        await tx.$queryRaw`SELECT set_config('crystal.audit_context', ${JSON.stringify({
          operationId: randomUUID(),
          source: 'maintenance:rename-pricing-batches',
          actor: { id: 'maintenance', username: 'maintenance', nickname: '批次名称维护' },
        })}, true)`;
      } else await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [target] = await tx.$queryRaw<{ database: string; username: string }[]>`
      SELECT current_database() AS database, current_user AS username`;
      assert.equal(target.database, 'crystal_mate_dev');
      assert.equal(target.username, 'crystal_dev');
      const before = await businessFingerprint(tx);
      const batches = await tx.materialBatch.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          entries: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              material: {
                select: { unit: true, pricingGroup: { select: { id: true, name: true } } },
              },
              distributor: { select: { id: true, name: true } },
            },
          },
        },
      });
      const occupied = new Set(batches.map((batch) => batch.name));
      const changes: { id: string; before: string; after: string; updatedAt: Date }[] = [];
      const skipped: { id: string; name: string }[] = [];
      for (const batch of batches) {
        if (batch.purpose !== 'PRICING' || !generatedName.test(batch.name)) continue;
        if (
          !batch.entries.length ||
          batch.entries.some(
            (entry) => entry.material.unit !== 'GRAM' || !entry.material.pricingGroup,
          )
        ) {
          skipped.push({ id: batch.id, name: batch.name });
          continue;
        }
        const base = pricingBatchNameBase(
          batch.receivedAt.toISOString().slice(0, 10),
          batch.entries.map((entry) => entry.material.pricingGroup!),
          batch.entries.map((entry) => entry.distributor),
        );
        // Preview uses the same collision rule as live writes, including earlier planned renames.
        const name = availablePricingBatchName(base, occupied);
        occupied.add(name);
        changes.push({ id: batch.id, before: batch.name, after: name, updatedAt: batch.updatedAt });
      }
      const directory = join(
        process.cwd(),
        'backups',
        'pricing-batch-names',
        new Date().toISOString().replace(/[:.]/g, '-'),
      );
      const result = { database: target.database, apply, changes, skipped, before };
      if (apply && changes.length) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, 'before.json'), JSON.stringify(result, null, 2), {
          mode: 0o600,
        });
        for (const change of changes) {
          assert.equal(await reservePricingBatchName(tx, change.after, change.id), change.after);
          const updated = await tx.materialBatch.updateMany({
            where: { id: change.id, name: change.before, updatedAt: change.updatedAt },
            data: { name: change.after },
          });
          assert.equal(updated.count, 1, 'Batch changed during renaming.');
        }
        assert.deepEqual(
          await businessFingerprint(tx),
          before,
          'Business data changed beyond batch names.',
        );
      }
      return {
        ...result,
        directory: apply && changes.length ? directory : null,
        businessDataUnchanged: true,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 },
  );
  if (report.directory)
    await writeFile(join(report.directory, 'result.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
  console.log(
    JSON.stringify(
      {
        database: report.database,
        applied: apply,
        renamed: report.changes.length,
        skipped: report.skipped.length,
        businessDataUnchanged: report.businessDataUnchanged,
        examples: report.changes.slice(0, 5),
        directory: report.directory,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Batch renaming failed.');
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
