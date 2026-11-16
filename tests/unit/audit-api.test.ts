import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  accounts: vi.fn(),
  refs: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    auditLog: { findMany: mocks.findMany, count: mocks.count },
    admin: { findMany: mocks.accounts },
    recordAttribution: { findMany: mocks.refs },
    $transaction: mocks.transaction,
  },
}));
import { GET } from '@/app/api/audit-logs/route';
const request = (query = '') => new NextRequest(`http://localhost/api/audit-logs${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'actor', name: 'admin', nickname: '豆子管理员' } });
  mocks.transaction.mockResolvedValue([[], 0, []]);
  mocks.refs.mockResolvedValue([]);
});
describe('operation history access and filters', () => {
  it('requires a valid authenticated session before reading history', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('rejects invalid dates, paging, types and actions before database access', async () => {
    for (const query of [
      '?page=0',
      '?pageSize=101',
      '?entityType=unknown',
      '?action=UPSERT',
      '?createdFrom=2026-11-17T00:00&createdTo=2026-11-16T00:00',
    ])
      expect((await GET(request(query))).status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('filters by stable actor id and Beijing time and links root and related records', async () => {
    expect(
      (
        await GET(
          request(
            '?actorId=actor&entityType=Product&entityId=product&action=DELETE&createdFrom=2026-11-16T00:00&createdTo=2026-11-16T23:59',
          ),
        )
      ).status,
    ).toBe(200);
    const { where } = mocks.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      actorId: 'actor',
      action: 'DELETE',
      OR: [
        { entityId: 'product', entityType: 'Product' },
        { rootId: 'product', rootType: 'Product' },
        { relatedIds: { has: 'product' } },
      ],
    });
    expect(where.createdAt.gte.toISOString()).toBe('2026-11-15T16:00:00.000Z');
    expect(where.createdAt.lt.toISOString()).toBe('2026-11-16T16:00:00.000Z');
  });
  it('supports system operations and all changes in a shared operation', async () => {
    await GET(request('?actorId=SYSTEM&operationId=operation'));
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({
      actorId: null,
      operationId: 'operation',
    });
  });
});
