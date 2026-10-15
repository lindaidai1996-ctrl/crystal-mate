import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT) || 3100;
const baseURL = `http://localhost:${port}`;
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error('Set E2E_DATABASE_URL to a dedicated test database.');
const target = new URL(databaseUrl);
const databaseName = decodeURIComponent(target.pathname.slice(1));
const normalUrl = process.env.E2E_NORMAL_DATABASE_URL ?? process.env.DATABASE_URL;
const normal = normalUrl ? new URL(normalUrl) : null;
if (
  !databaseName.endsWith('_test') ||
  (normal &&
    target.hostname === normal.hostname &&
    (target.port || '5432') === (normal.port || '5432') &&
    target.pathname === normal.pathname &&
    target.searchParams.get('schema') === normal.searchParams.get('schema'))
)
  throw new Error('E2E_DATABASE_URL must point to a separate database ending in _test.');
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : undefined,
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `${baseURL}/zh/login`,
    env: {
      E2E_DIST_DIR: process.env.E2E_DIST_DIR ?? '.next-e2e',
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
    },
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: 'list',
});
