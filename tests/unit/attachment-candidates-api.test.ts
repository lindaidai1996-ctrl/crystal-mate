import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), candidates: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/attachment-candidates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachment-candidates')>()),
  getAttachmentCandidates: mocks.candidates,
}));
import { GET as distributorCandidates } from '@/app/api/distributors/[id]/attachment-candidates/route';
import { GET as batchCandidates } from '@/app/api/material-batches/[id]/attachment-candidates/route';
import { ApiError } from '@/lib/api';

const id = 'cmv60i7vq00043wapt6b5xvp9';
const context = { params: Promise.resolve({ id }) };
const request = (query = '') => new NextRequest(`http://localhost/api/candidates${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.candidates.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

describe.each([
  { owner: 'distributor', handler: distributorCandidates },
  { owner: 'batch', handler: batchCandidates },
])('$owner attachment candidates API', ({ owner, handler }) => {
  it('requires authentication before reading candidate images', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await handler(request(), context)).status).toBe(401);
    expect(mocks.candidates).not.toHaveBeenCalled();
  });

  it('scopes requests to the owner and trims search, with bounded pagination', async () => {
    expect((await handler(request('?q=%20jade%20&type=material&page=2'), context)).status).toBe(
      200,
    );
    expect(mocks.candidates).toHaveBeenCalledWith(
      { type: owner, id },
      { q: 'jade', type: 'material', page: 2, pageSize: 20 },
    );
    for (const query of [
      '?page=0',
      '?page=1.5',
      '?pageSize=51',
      '?type=unknown',
      `?q=${'x'.repeat(201)}`,
    ]) {
      expect((await handler(request(query), context)).status).toBe(400);
    }
    expect((await handler(request(), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(
      400,
    );
    expect(mocks.candidates).toHaveBeenCalledTimes(1);
  });

  it('preserves missing-owner errors and returns the candidate page', async () => {
    mocks.candidates.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND'));
    expect((await handler(request(), context)).status).toBe(404);
    expect(await (await handler(request(), context)).json()).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });
});
