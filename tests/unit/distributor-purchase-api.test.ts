import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  summary: vi.fn(),
  entries: vi.fn(),
  detail: vi.fn(),
  areas: vi.fn(),
  list: vi.fn(),
  areaCounts: vi.fn(),
  itemCounts: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    distributor: {
      findUnique: mocks.detail,
      findMany: mocks.list,
      groupBy: mocks.areaCounts,
    },
    distributorArea: { findMany: mocks.areas },
  },
}));
vi.mock('@/lib/distributor-purchases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/distributor-purchases')>()),
  getDistributorPurchaseSummary: mocks.summary,
  getDistributorPurchaseEntries: mocks.entries,
  getDistributorItemCounts: mocks.itemCounts,
}));
import { GET as list } from '../../src/app/api/distributors/route';
import { GET as detail } from '../../src/app/api/distributors/[id]/route';
import { GET as summary } from '../../src/app/api/distributors/[id]/purchases/route';
import { GET as entries } from '../../src/app/api/distributors/[id]/purchases/entries/route';
import { ApiError } from '../../src/lib/api';

const id = 'cmv60i7vq00043wapt6b5xvp9';
const context = { params: Promise.resolve({ id }) };
const request = (suffix = '') =>
  new NextRequest(`http://localhost/api/distributors/${id}${suffix}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.summary.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mocks.entries.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

describe('distributor read APIs', () => {
  it('includes item counts and zero defaults in the list without losing area or attachment data', async () => {
    const attachments = [{ objectKey: 'receipt.png', notes: '凭证' }];
    mocks.list.mockResolvedValue([
      { id, name: '已有进货', attachments },
      { id: 'empty', name: '暂无进货', attachments: [] },
    ]);
    mocks.areas.mockResolvedValue([{ id: 'area', name: '东海' }]);
    mocks.areaCounts.mockResolvedValue([{ area: '东海', _count: { _all: 2 } }]);
    mocks.itemCounts.mockResolvedValue(new Map([[id, { total: 5, products: 2, materials: 3 }]]));
    const response = await list(new NextRequest('http://localhost/api/distributors'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { id, name: '已有进货', attachments, itemCounts: { total: 5, products: 2, materials: 3 } },
        {
          id: 'empty',
          name: '暂无进货',
          attachments: [],
          itemCounts: { total: 0, products: 0, materials: 0 },
        },
      ],
      areas: ['东海'],
      areaItems: [{ id: 'area', name: '东海', distributorCount: 2 }],
    });
  });
  it('requires admin authentication for every endpoint before reading data', async () => {
    mocks.auth.mockResolvedValue(null);
    for (const handler of [detail, summary, entries])
      expect((await handler(request(), context)).status).toBe(401);
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.entries).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect((await list(new NextRequest('http://localhost/api/distributors'))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.itemCounts).not.toHaveBeenCalled();
  });
  it('defaults to 20 rows, trims searches, and validates pagination and identity', async () => {
    expect((await summary(request('/purchases?q=%20test%20'), context)).status).toBe(200);
    expect(mocks.summary).toHaveBeenCalledWith(id, {
      type: 'all',
      q: 'test',
      page: 1,
      pageSize: 20,
    });
    for (const query of [
      '?page=0',
      '?pageSize=51',
      '?page=1.5',
      '?type=unknown',
      `?q=${'x'.repeat(201)}`,
    ]) {
      expect((await summary(request(`/purchases${query}`), context)).status).toBe(400);
    }
    for (const handler of [detail, summary, entries]) {
      expect(
        (await handler(request(), { params: Promise.resolve({ id: 'invalid' }) })).status,
      ).toBe(400);
    }
  });
  it('requires a concrete type and item id for paginated batch details', async () => {
    expect((await entries(request('/purchases/entries?type=all'), context)).status).toBe(400);
    expect(
      (await entries(request('/purchases/entries?type=material&itemId=bad'), context)).status,
    ).toBe(400);
    expect(
      (await entries(request(`/purchases/entries?type=material&itemId=${id}&page=2`), context))
        .status,
    ).toBe(200);
    expect(mocks.entries).toHaveBeenCalledWith(id, {
      type: 'material',
      itemId: id,
      page: 2,
      pageSize: 20,
    });
  });
  it('returns 404 for missing suppliers and preserves attachment metadata in details', async () => {
    mocks.detail.mockResolvedValue(null);
    mocks.areas.mockResolvedValue([]);
    expect((await detail(request(), context)).status).toBe(404);
    mocks.summary.mockRejectedValue(new ApiError(404, 'NOT_FOUND'));
    mocks.entries.mockRejectedValue(new ApiError(404, 'NOT_FOUND'));
    expect((await summary(request('/purchases'), context)).status).toBe(404);
    expect(
      (await entries(request(`/purchases/entries?type=product&itemId=${id}`), context)).status,
    ).toBe(404);
    const item = { id, name: '渠道商', attachments: [{ objectKey: 'receipt.png', notes: '凭证' }] };
    mocks.detail.mockResolvedValue(item);
    mocks.areas.mockResolvedValue([{ name: '东海' }]);
    expect(await (await detail(request(), context)).json()).toEqual({ item, areas: ['东海'] });
  });
});
