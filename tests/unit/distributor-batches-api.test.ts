import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), batches: vi.fn(), entries: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/distributor-batches', async (original) => ({
  ...(await original<typeof import('../../src/lib/distributor-batches')>()),
  getDistributorBatches: mocks.batches,
  getDistributorBatchEntries: mocks.entries,
}));
import { GET as batches } from '../../src/app/api/distributors/[id]/batches/route';
import { GET as entries } from '../../src/app/api/distributors/[id]/batches/[batchId]/entries/route';
import { ApiError } from '../../src/lib/api';
const id = 'cmv60i7vq00043wapt6b5xvp9';
const batchId = 'cmv60i7vq00043wapt6b5xvp8';
const context = { params: Promise.resolve({ id, batchId }) };
const request = (query = '') =>
  new NextRequest(`http://localhost/api/distributors/${id}/batches${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'admin', name: 'admin', nickname: '' } });
  mocks.batches.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mocks.entries.mockResolvedValue({ items: [], total: 1, page: 99, pageSize: 20 });
});
describe('distributor batch read APIs', () => {
  it('checks authentication before querying either endpoint', async () => {
    mocks.auth.mockResolvedValue(null);
    for (const handler of [batches, entries])
      expect((await handler(request(), context)).status).toBe(401);
    expect(mocks.batches).not.toHaveBeenCalled();
    expect(mocks.entries).not.toHaveBeenCalled();
  });
  it('trims searches and passes inclusive date boundaries and pagination', async () => {
    expect(
      (
        await batches(
          request('?q=%20batch%20&receivedFrom=2026-10-02&receivedTo=2026-10-02'),
          context,
        )
      ).status,
    ).toBe(200);
    expect(mocks.batches).toHaveBeenCalledWith(id, {
      q: 'batch',
      receivedFrom: '2026-10-02',
      receivedTo: '2026-10-02',
      page: 1,
      pageSize: 20,
    });
    expect((await entries(request('?page=99'), context)).status).toBe(200);
    expect(mocks.entries).toHaveBeenCalledWith(id, batchId, { page: 99, pageSize: 20 });
  });
  it('rejects invalid dates, reversed ranges, identities and pagination', async () => {
    for (const query of [
      '?receivedFrom=2026-02-30',
      '?receivedFrom=bad',
      '?receivedFrom=2026-10-03&receivedTo=2026-10-02',
      '?page=0',
      '?pageSize=51',
      '?page=1.5',
      `?q=${'a'.repeat(201)}`,
    ]) {
      expect((await batches(request(query), context)).status).toBe(400);
    }
    expect((await entries(request('?pageSize=0'), context)).status).toBe(400);
    expect(
      (await entries(request(), { params: Promise.resolve({ id, batchId: 'bad' }) })).status,
    ).toBe(400);
    for (const handler of [batches, entries])
      expect(
        (await handler(request(), { params: Promise.resolve({ id: 'bad', batchId }) })).status,
      ).toBe(400);
  });
  it('preserves not-found errors for missing distributors or unrelated batches', async () => {
    mocks.batches.mockRejectedValue(new ApiError(404, 'NOT_FOUND'));
    mocks.entries.mockRejectedValue(new ApiError(404, 'NOT_FOUND'));
    for (const handler of [batches, entries])
      expect((await handler(request(), context)).status).toBe(404);
  });
});
