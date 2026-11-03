import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import { PATCH, DELETE } from '../../src/app/api/materials/bulk/route';
import { POST } from '../../src/app/api/materials/bulk/preview/route';
import { apiFetch, ClientApiError } from '../../src/lib/client-api';

const id = 'clx1234567890123456789012';
const snapshot = { materials: [{ id, updatedAt: new Date().toISOString() }], entries: [] };
function request(method: string, body: unknown, origin = 'http://localhost') {
  return new NextRequest('http://localhost/api/materials/bulk', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
});

describe('material bulk API', () => {
  it('requires authentication and same-origin requests for every action', async () => {
    for (const [method, handler] of [
      ['POST', POST],
      ['PATCH', PATCH],
      ['DELETE', DELETE],
    ] as const) {
      mocks.auth.mockResolvedValue(null);
      expect((await handler(request(method, {}))).status).toBe(401);
      mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
      expect((await handler(request(method, {}, 'http://other.test'))).status).toBe(403);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('rejects missing snapshots, invalid IDs and unsupported changes before database access', async () => {
    expect((await POST(request('POST', { materialIds: [] }))).status).toBe(400);
    expect((await DELETE(request('DELETE', { materialIds: [id] }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { snapshot, entryIds: [], changes: {} }))).status).toBe(
      400,
    );
    expect(
      (await PATCH(request('PATCH', { snapshot, entryIds: [], changes: { name: 'unsupported' } })))
        .status,
    ).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('accepts supported preview, category-only update and delete payloads', async () => {
    mocks.transaction.mockResolvedValue({ materialCount: 1 });
    expect((await POST(request('POST', { materialIds: [id] }))).status).toBe(200);
    expect(
      (await PATCH(request('PATCH', { snapshot, entryIds: [], changes: { categoryId: id } })))
        .status,
    ).toBe(200);
    expect(await (await DELETE(request('DELETE', { snapshot }))).json()).toEqual({
      materialCount: 1,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
  it('reports serialization conflicts without retrying a stock adjustment', async () => {
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: '6.12.0',
      }),
    );
    const response = await PATCH(
      request('PATCH', {
        snapshot,
        entryIds: [id],
        changes: { stock: { mode: 'ADD', quantities: { BEAD: 1 } } },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'BULK_CHANGED', issues: [] });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it('preserves actionable error details in the client', async () => {
    const issues = [{ materialId: id, name: 'Material', code: 'DIY_IN_USE' }];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'BULK_FAILED', issues }), { status: 409 }),
        ),
    );
    try {
      const error = await apiFetch('/api/materials/bulk').catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ClientApiError);
      expect(error).toMatchObject({ code: 'BULK_FAILED', issues });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
