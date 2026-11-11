import { readFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Explicit environment file only: never silently choose the development database.
const envPath = process.argv[2];
const settings = envPath ? dotenv.parse(await readFile(envPath)) : process.env;
const url = settings.DIRECT_URL || settings.DATABASE_URL;
if (!url) throw new Error('Set DIRECT_URL or provide an explicit environment file.');

const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
try {
  const snapshot = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      const [server] = await tx.$queryRawUnsafe(
        "SELECT current_setting('server_version') AS version",
      );
      const tables = await tx.$queryRawUnsafe(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      );
      const records = {};
      for (const { tablename } of tables) {
        const identifier = `"public"."${tablename.replaceAll('"', '""')}"`;
        const [row] = await tx.$queryRawUnsafe(
          `SELECT count(*)::text AS count,
            md5(coalesce(string_agg(md5(to_jsonb(t)::text), ''
              ORDER BY md5(to_jsonb(t)::text)), '')) AS fingerprint
           FROM ${identifier} t`,
        );
        records[tablename] = row;
      }
      return { version: server.version, tables: records };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000, maxWait: 15000 },
  );
  console.log(JSON.stringify(snapshot, null, 2));
} catch {
  // Connection errors may contain URLs or infrastructure details; keep secrets out of logs.
  console.error('Read-only database inspection failed; check connectivity and credentials.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
