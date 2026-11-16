import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIY_COMMON_FEES } from '../../src/lib/diy-common-fees';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: { diyCommonFeeSettings: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}));

import { GET, PUT } from '../../src/app/api/settings/diy-common-fees/route';

const url = 'http://localhost/api/settings/diy-common-fees';
function put(body: unknown, origin = 'http://localhost') {
  return PUT(
    new NextRequest(url, {
      method: 'PUT',
      headers: { origin },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
});

describe('DIY common fee settings API', () => {
  it('requires authentication and rejects cross-origin writes', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect((await put([])).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: 'admin-id', name: 'admin', nickname: '' } });
    expect((await put([], 'http://other.test')).status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('returns packaging and shipping defaults only before settings are first saved', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await (await GET(new NextRequest(url))).json()).toEqual(DEFAULT_DIY_COMMON_FEES);
    mocks.findUnique.mockResolvedValue({ fees: [] });
    expect(await (await GET(new NextRequest(url))).json()).toEqual([]);
  });

  it('persists edited templates and allows deleting every template', async () => {
    const fees = [{ ...DEFAULT_DIY_COMMON_FEES[0], name: '礼盒', amount: '6', quoteAmount: '15' }];
    mocks.upsert.mockResolvedValue({ fees });
    expect(await (await put(fees)).json()).toEqual(fees);
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default', fees },
      update: { fees },
    });
    mocks.upsert.mockResolvedValue({ fees: [] });
    expect(await (await put([])).json()).toEqual([]);
  });

  it('rejects invalid updates without writing settings', async () => {
    const fee = DEFAULT_DIY_COMMON_FEES[0];
    for (const input of [
      [{ ...fee, quoteAmount: '-1' }],
      [{ ...fee, amount: 'abc' }],
      [fee, fee],
      [{ ...fee, name: '' }],
    ])
      expect((await put(input)).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('reports database failures instead of silently restoring initial defaults', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.findUnique.mockRejectedValue(new Error('database unavailable'));
      expect((await GET(new NextRequest(url))).status).toBe(500);
    } finally {
      log.mockRestore();
    }
  });
});
