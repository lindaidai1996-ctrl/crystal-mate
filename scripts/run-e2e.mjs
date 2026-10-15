import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const databaseUrl = process.env.E2E_DATABASE_URL;
const username = process.env.E2E_USERNAME ?? process.env.ADMIN_USERNAME;
const password = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD;
if (!databaseUrl || !username || !password) {
  console.error('Set E2E_DATABASE_URL, E2E_USERNAME, and E2E_PASSWORD.');
  process.exit(1);
}

let target;
try {
  target = new URL(databaseUrl);
} catch {
  console.error('E2E_DATABASE_URL is not a valid PostgreSQL URL.');
  process.exit(1);
}
const normal = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (
  !decodeURIComponent(target.pathname.slice(1)).endsWith('_test') ||
  (normal &&
    target.hostname === normal.hostname &&
    (target.port || '5432') === (normal.port || '5432') &&
    target.pathname === normal.pathname &&
    target.searchParams.get('schema') === normal.searchParams.get('schema'))
) {
  console.error('E2E_DATABASE_URL must point to a separate database ending in _test.');
  process.exit(1);
}

const env = {
  ...process.env,
  E2E_NORMAL_DATABASE_URL: process.env.DATABASE_URL ?? '',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  E2E_USERNAME: username,
  E2E_PASSWORD: password,
  ADMIN_USERNAME: username,
  ADMIN_PASSWORD: password,
  MEDIA_STORAGE: process.env.E2E_MEDIA_STORAGE ?? 'local',
};

const declarationsPath = join(process.cwd(), 'next-env.d.ts');
const originalDeclarations = readFileSync(declarationsPath, 'utf8');
let exitCode = 0;
try {
  for (const [binary, args] of [
    ['prisma', ['migrate', 'deploy']],
    ['tsx', ['scripts/create-admin.ts']],
    ['playwright', ['test', ...process.argv.slice(2)]],
  ]) {
    const result = spawnSync(join(process.cwd(), 'node_modules', '.bin', binary), args, {
      env,
      stdio: 'inherit',
    });
    if (result.error) console.error(result.error);
    exitCode = result.error ? 1 : (result.status ?? 1);
    if (exitCode !== 0) break;
  }
} finally {
  const generatedDeclarations = originalDeclarations.replaceAll(
    './.next/',
    `./${process.env.E2E_DIST_DIR ?? '.next-e2e'}/dev/`,
  );
  if (
    generatedDeclarations !== originalDeclarations &&
    readFileSync(declarationsPath, 'utf8') === generatedDeclarations
  ) {
    writeFileSync(declarationsPath, originalDeclarations);
  }
}
process.exitCode = exitCode;
