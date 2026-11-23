import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  publish: vi.fn(),
  history: vi.fn(),
  options: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/material-pricing/service', () => ({
  listPricingGroups: mocks.list,
  savePricingGroup: mocks.save,
  getPricingPreview: mocks.preview,
  publishPricingGroup: mocks.publish,
  listPricingHistory: mocks.history,
  listPricingOptions: mocks.options,
}));
import { GET, POST } from '@/app/api/material-pricing-groups/route';
import { PATCH } from '@/app/api/material-pricing-groups/[id]/route';
import { GET as preview } from '@/app/api/material-pricing-groups/[id]/preview/route';
import { POST as publish } from '@/app/api/material-pricing-groups/[id]/publish/route';
import { GET as history } from '@/app/api/material-pricing-groups/[id]/history/route';
import { GET as options } from '@/app/api/material-pricing-groups/options/route';
import { ApiError } from '@/lib/api';
const id = 'cm000000000000000000000001';
const root = 'http://localhost/api/material-pricing-groups';
const context = { params: Promise.resolve({ id }) };
const request = (url = root, method = 'GET', origin = 'http://localhost') =>
  new NextRequest(url, {
    method,
    ...(method === 'GET'
      ? {}
      : { headers: { origin }, body: JSON.stringify({ name: '银饰', version: 2 }) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'admin', name: 'admin', nickname: '' } });
  for (const fn of [
    mocks.list,
    mocks.save,
    mocks.preview,
    mocks.publish,
    mocks.history,
    mocks.options,
  ])
    fn.mockResolvedValue({ items: [] });
});
describe('material pricing authenticated HTTP boundary', () => {
  it('requires login on group, cost, option, publication and history endpoints before reading or writing data', async () => {
    mocks.auth.mockResolvedValue(null);
    const responses = await Promise.all([
      GET(request()),
      POST(request(root, 'POST')),
      PATCH(request(`${root}/${id}`, 'PATCH'), context),
      preview(request(`${root}/${id}/preview`), context),
      publish(request(`${root}/${id}/publish`, 'POST'), context),
      history(request(`${root}/${id}/history`), context),
      options(request(`${root}/options`)),
    ]);
    expect(responses.every((response) => response.status === 401)).toBe(true);
    for (const fn of [
      mocks.list,
      mocks.save,
      mocks.preview,
      mocks.publish,
      mocks.history,
      mocks.options,
    ])
      expect(fn).not.toHaveBeenCalled();
  });
  it('returns uncached business responses and dispatches the route identity, not a body-supplied identity', async () => {
    const responses = [
      await GET(request()),
      await POST(request(root, 'POST')),
      await PATCH(request(`${root}/${id}`, 'PATCH'), context),
      await preview(request(`${root}/${id}/preview`), context),
      await publish(request(`${root}/${id}/publish`, 'POST'), context),
      await history(request(`${root}/${id}/history?page=2`), context),
      await options(request(`${root}/options`)),
    ];
    expect(
      responses.every(
        (response) => response.ok && response.headers.get('cache-control') === 'no-store',
      ),
    ).toBe(true);
    expect(mocks.save).toHaveBeenLastCalledWith({ name: '银饰', version: 2 }, id);
    expect(mocks.history).toHaveBeenCalledWith(id, 2);
  });
  it('rejects cross-origin writes and invalid history pagination without service calls', async () => {
    expect((await POST(request(root, 'POST', 'http://other.test'))).status).toBe(403);
    expect(
      (await PATCH(request(`${root}/${id}`, 'PATCH', 'http://other.test'), context)).status,
    ).toBe(403);
    expect(
      (await publish(request(`${root}/${id}/publish`, 'POST', 'http://other.test'), context))
        .status,
    ).toBe(403);
    expect((await history(request(`${root}/${id}/history?page=0`), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it('returns a conflict for a stale version and never substitutes defaults on failure', async () => {
    mocks.publish.mockRejectedValue(new ApiError(409, 'PRICING_CHANGED'));
    const response = await publish(request(`${root}/${id}/publish`, 'POST'), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'PRICING_CHANGED' });
  });
});
