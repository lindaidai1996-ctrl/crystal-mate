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
import { GET as getAttributions } from '@/app/api/record-attributions/route';
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
  it('displays current account nicknames while retaining removed-account and system snapshots', async () => {
    const actors = [{ id: 'admin2-id', username: 'admin2', nickname: '呆呆' }];
    const items = [
      {
        id: 'known',
        actorId: 'admin2-id',
        actorUsername: 'admin2',
        actorNickname: '呆呆管理员',
        relatedIds: [],
      },
      {
        id: 'removed',
        actorId: 'removed-id',
        actorUsername: 'removed',
        actorNickname: '历史昵称',
        relatedIds: [],
      },
      { id: 'system', actorId: null, actorNickname: null, relatedIds: [] },
    ];
    mocks.transaction.mockResolvedValue([items, items.length, actors]);
    const response = await GET(request());
    const body = await response.json();
    expect(body.items[0]).toMatchObject({ actorUsername: 'admin2', actorNickname: '呆呆' });
    expect(body.items.slice(1)).toEqual(items.slice(1));
    expect(items[0].actorNickname).toBe('呆呆管理员');
  });
  it('resolves creator and editor nicknames without inventing unknown or system identities', async () => {
    const creator = { id: 'admin2-id', username: 'admin2', nickname: '呆呆' };
    const editor = { id: 'admin-id', username: 'admin', nickname: '豆子' };
    const removed = { id: 'removed-id', username: 'removed', nickname: '历史昵称' };
    const system = { id: 'SYSTEM', username: 'SYSTEM', nickname: '' };
    mocks.transaction.mockResolvedValue([
      [
        {
          entityId: 'product',
          createdBy: { ...creator, nickname: '呆呆管理员' },
          updatedBy: { ...editor, nickname: '豆子管理员' },
        },
        { entityId: 'unknown', createdBy: null, updatedBy: null },
        { entityId: 'removed', createdBy: removed, updatedBy: system },
      ],
      [creator, editor],
    ]);
    const response = await getAttributions(
      request('?entityType=Product&ids=product,unknown,removed'),
    );
    expect(await response.json()).toEqual([
      { entityId: 'product', createdBy: creator, updatedBy: editor },
      { entityId: 'unknown', createdBy: null, updatedBy: null },
      { entityId: 'removed', createdBy: removed, updatedBy: system },
    ]);
  });
});
