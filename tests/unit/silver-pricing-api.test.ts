import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: { silverPricing: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}));

import { GET, PUT } from '../../src/app/api/settings/silver-pricing/route';

const url = 'http://localhost/api/settings/silver-pricing';
function put(body: unknown, origin = 'http://localhost') {
  return PUT(
    new NextRequest(url, { method: 'PUT', headers: { origin }, body: JSON.stringify(body) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
});

describe('silver pricing defaults API', () => {
  it('requires authentication for reads and writes', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect((await put({ costGramPrice: '20', quoteGramPrice: '30' })).status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('returns initial prices only when no configuration exists', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const response = await GET(new NextRequest(url));
    expect(await response.json()).toEqual({ costGramPrice: '20.00', quoteGramPrice: '30.00' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('stores both prices together and returns the stored values on subsequent reads', async () => {
    const row = {
      costGramPrice: new Prisma.Decimal('21.25'),
      quoteGramPrice: new Prisma.Decimal('32.5'),
    };
    mocks.upsert.mockResolvedValue(row);
    mocks.findUnique.mockResolvedValue(row);
    const input = { costGramPrice: '21.25', quoteGramPrice: '32.5' };
    const response = await put(input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ costGramPrice: '21.25', quoteGramPrice: '32.50' });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default', ...input },
      update: input,
    });
    expect(await (await GET(new NextRequest(url))).json()).toEqual({
      costGramPrice: '21.25',
      quoteGramPrice: '32.50',
    });
  });

  it('rejects partial, negative and overly precise updates and cross-origin writes', async () => {
    for (const input of [
      { costGramPrice: '20' },
      { costGramPrice: '-1', quoteGramPrice: '30' },
      { costGramPrice: '20', quoteGramPrice: '30.001' },
    ])
      expect((await put(input)).status).toBe(400);
    expect(
      (await put({ costGramPrice: '20', quoteGramPrice: '30' }, 'http://other.test')).status,
    ).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('reports database failures instead of returning initial prices', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.findUnique.mockRejectedValue(new Error('database unavailable'));
      const response = await GET(new NextRequest(url));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'SERVER_ERROR' });
    } finally {
      log.mockRestore();
    }
  });
});
