import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  imports: vi.fn(),
  draft: vi.fn(),
  load: vi.fn(),
  update: vi.fn(),
  commit: vi.fn(),
  start: vi.fn(),
  run: vi.fn(),
  after: vi.fn(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/material-pricing/purchase-service', () => ({
  listProcurement: mocks.list,
  getProcurement: mocks.get,
  saveProcurement: mocks.save,
}));
vi.mock('@/lib/material-pricing-import/store', () => ({
  listSilverImports: mocks.imports,
  createSilverImport: mocks.draft,
  getSilverImport: mocks.load,
  updateSilverImport: mocks.update,
  commitSilverRow: mocks.commit,
  startSilverImport: mocks.start,
  runSilverImport: mocks.run,
}));
import { GET, POST } from '@/app/api/material-pricing-purchases/route';
import { GET as get, PATCH } from '@/app/api/material-pricing-purchases/[id]/route';
import { GET as imports, POST as draft } from '@/app/api/material-pricing-imports/route';
import { GET as load, PATCH as update } from '@/app/api/material-pricing-imports/[id]/route';
import { POST as commit } from '@/app/api/material-pricing-imports/[id]/commit/route';
import { POST as start } from '@/app/api/material-pricing-imports/[id]/run/route';
import { auditContext } from '@/lib/audit-context';
import { POST as catalog } from '@/app/api/material-pricing-purchases/catalog/route';
const context = { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) };
const request = (
  method = 'GET',
  origin = 'http://localhost',
  body: unknown = { version: 0, rowNumber: 4 },
) =>
  new NextRequest('http://localhost/api/material-pricing-imports', {
    method,
    ...(method === 'GET' ? {} : { headers: { origin }, body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'admin', name: 'admin' } });
  for (const [key, value] of Object.entries(mocks))
    if (key !== 'auth' && key !== 'after') value.mockResolvedValue({ items: [] });
});
describe('silver procurement HTTP boundaries', () => {
  it('requires authentication before any read, draft, catalog or purchase write', async () => {
    mocks.auth.mockResolvedValue(null);
    const responses = await Promise.all([
      GET(request()),
      POST(request('POST')),
      get(request(), context),
      PATCH(request('PATCH'), context),
      imports(request()),
      draft(request('POST')),
      load(request(), context),
      update(request('PATCH'), context),
      commit(request('POST'), context),
      start(request('POST'), context),
      catalog(request('POST')),
    ]);
    expect(responses.every((response) => response.status === 401)).toBe(true);
    for (const [key, value] of Object.entries(mocks))
      if (key !== 'auth') expect(value).not.toHaveBeenCalled();
  });
  it('rejects cross-origin writes before business services run', async () => {
    const responses = await Promise.all([
      POST(request('POST', 'http://other.test')),
      PATCH(request('PATCH', 'http://other.test'), context),
      draft(request('POST', 'http://other.test')),
      update(request('PATCH', 'http://other.test'), context),
      commit(request('POST', 'http://other.test'), context),
      start(request('POST', 'http://other.test'), context),
      catalog(request('POST', 'http://other.test')),
    ]);
    expect(responses.every((response) => response.status === 403)).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it('returns uncached results and binds commit identity to route and version to validated body', async () => {
    const responses = await Promise.all([
      GET(request()),
      get(request(), context),
      imports(request()),
      load(request(), context),
      commit(request('POST'), context),
    ]);
    expect(
      responses.every(
        (response) => response.ok && response.headers.get('cache-control') === 'no-store',
      ),
    ).toBe(true);
    expect(mocks.commit).toHaveBeenCalledWith((await context.params).id, 4, 0);
    const invalid = await commit(
      request('POST', 'http://localhost', { version: -1, rowNumber: 4 }),
      context,
    );
    expect(invalid.status).toBe(400);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });
  it('accepts a durable task before executing it and preserves authenticated audit context after response', async () => {
    mocks.start.mockResolvedValue({
      job: { id: 'job', progress: { status: 'RUNNING' } },
      token: 'worker-token',
    });
    mocks.run.mockImplementation(async () => {
      expect(auditContext.getStore()?.actor?.id).toBe('admin');
      expect(auditContext.getStore()?.source).toBe('POST /api/material-pricing-imports');
    });
    const response = await start(
      request('POST', 'http://localhost', { version: 3, rowNumbers: [4, 5] }),
      context,
    );
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ id: 'job', progress: { status: 'RUNNING' } });
    expect(mocks.start).toHaveBeenCalledWith((await context.params).id, {
      version: 3,
      rowNumbers: [4, 5],
    });
    expect(mocks.run).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.run).toHaveBeenCalledWith((await context.params).id, 'worker-token');
    mocks.after.mockClear();
    mocks.start.mockResolvedValue({ job: { id: 'job' }, token: null });
    await start(request('POST'), context);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
