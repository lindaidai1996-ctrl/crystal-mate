import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), add: vi.fn(), update: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/product-sources', () => ({
  addProductSource: mocks.add,
  updateProductSource: mocks.update,
  deleteProductSource: vi.fn(),
  serializeProductSources: () => ({ diyRuns: [], purchaseEntries: [], stockAdjustments: [] }),
}));

import { POST } from '@/app/api/products/[id]/sources/route';
import { PUT } from '@/app/api/products/[id]/sources/[sourceId]/route';
import { ApiError } from '@/lib/api';
import { Prisma } from '@prisma/client';

const source = {
  origin: 'DIY',
  quantity: 1,
  materials: [],
  cabochons: [],
  extraCosts: [],
  notes: '',
};
const pricing = { priceCents: 42900, expectedPriceCents: 38880 };
const context = { params: Promise.resolve({ id: 'product', sourceId: 'run' }) };
const request = (method: string, body: object, origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/products/product/sources/run', {
    method,
    headers: { origin },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'admin', name: 'admin', nickname: '' } });
  const saved = {
    stock: 1,
    priceCents: 42900,
    saleManual: true,
    updatedAt: new Date('2026-11-25T00:00:00Z'),
  };
  mocks.add.mockResolvedValue(saved);
  mocks.update.mockResolvedValue(saved);
});

describe.each([
  ['POST', POST],
  ['PUT', PUT],
] as const)('DIY pricing %s API', (method, handler) => {
  it('returns saved pricing with the source, without requiring a second request', async () => {
    const response = await handler(request(method, { source, pricing }), context);
    expect(response.status).toBe(method === 'POST' ? 201 : 200);
    expect(await response.json()).toMatchObject({
      priceCents: 42900,
      saleManual: true,
      stock: 1,
      diyRuns: [],
    });
    if (method === 'POST') expect(mocks.add).toHaveBeenCalledWith('product', source, pricing);
    else expect(mocks.update).toHaveBeenCalledWith('product', 'run', source, pricing);
  });

  it('round-trips a complete rule and parameter', async () => {
    const full = {
      ...pricing,
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: '20.25',
      saleManual: false,
      expectedPricing: { saleRule: 'PERCENT_50', saleRuleValue: null, saleManual: true },
    };
    const saved = {
      priceCents: 2225,
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: new Prisma.Decimal('20.25'),
      saleManual: false,
    };
    mocks.add.mockResolvedValue(saved);
    mocks.update.mockResolvedValue(saved);
    const response = await handler(request(method, { source, pricing: full }), context);
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({ ...saved, saleRuleValue: '20.25' });
    if (method === 'POST') expect(mocks.add).toHaveBeenCalledWith('product', source, full);
    else expect(mocks.update).toHaveBeenCalledWith('product', 'run', source, full);
  });

  it('continues accepting source-only saves', async () => {
    const response = await handler(request(method, source), context);
    expect(response.ok).toBe(true);
    if (method === 'POST') expect(mocks.add).toHaveBeenCalledWith('product', source, undefined);
    else expect(mocks.update).toHaveBeenCalledWith('product', 'run', source, undefined);
  });

  it('rejects invalid pricing before starting a write', async () => {
    expect(
      (
        await handler(
          request(method, { source, pricing: { ...pricing, priceCents: 2147483648 } }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('enforces authentication and same-origin writes', async () => {
    expect(
      (await handler(request(method, { source, pricing }, 'https://elsewhere.example'), context))
        .status,
    ).toBe(403);
    mocks.auth.mockResolvedValue(null);
    expect((await handler(request(method, { source, pricing }), context)).status).toBe(401);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns a price conflict without claiming success', async () => {
    mocks.add.mockRejectedValue(new ApiError(409, 'PRODUCT_PRICE_CHANGED'));
    mocks.update.mockRejectedValue(new ApiError(409, 'PRODUCT_PRICE_CHANGED'));
    const response = await handler(request(method, { source, pricing }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'PRODUCT_PRICE_CHANGED' });
  });
});
