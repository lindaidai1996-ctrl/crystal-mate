import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), material: vi.fn(), product: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/material-stock', () => ({ adjustMaterialStock: mocks.material }));
vi.mock('@/lib/product-sources', () => ({
  adjustProductStock: mocks.product,
  serializeProductSources: (value: object) => value,
}));
import { POST as materialPost } from '../../src/app/api/materials/[id]/batches/[entryId]/stock-adjustments/route';
import { POST as productPost } from '../../src/app/api/products/[id]/stock-adjustments/route';
import { ApiError } from '../../src/lib/api';

const context = { params: Promise.resolve({ id: 'item', entryId: 'entry' }) };
const request = (body: object, origin = 'http://localhost') =>
  new NextRequest('http://localhost/api/inventory', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
});

describe('inventory API', () => {
  it('requires authentication and same-origin writes', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await materialPost(request({}), context)).status).toBe(401);
    expect((await productPost(request({}), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
    expect(
      (
        await materialPost(
          request({ quantity: 1, expectedQuantity: 0 }, 'http://other.test'),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.material).not.toHaveBeenCalled();
    expect(mocks.product).not.toHaveBeenCalled();
  });

  it('accepts zero and unknown material stock snapshots', async () => {
    mocks.material.mockResolvedValue({ remainingQty: 0, stockAdjustments: [] });
    const response = await materialPost(request({ quantity: 0, expectedQuantity: null }), context);
    expect(response.status).toBe(201);
    expect(mocks.material).toHaveBeenCalledWith('item', 'entry', {
      quantity: 0,
      expectedQuantity: null,
      reason: '',
    });
  });

  it('passes decimal material stock to unit-aware validation and keeps products integral', async () => {
    mocks.material.mockResolvedValue({ remainingQty: 2.5, stockAdjustments: [] });
    expect(
      (await materialPost(request({ quantity: 2.5, expectedQuantity: 3.25 }), context)).status,
    ).toBe(201);
    expect(mocks.material).toHaveBeenCalledWith('item', 'entry', {
      quantity: 2.5,
      expectedQuantity: 3.25,
      reason: '',
    });
    expect(
      (await productPost(request({ quantity: 2.5, expectedQuantity: 3 }), context)).status,
    ).toBe(400);
  });

  it('supports actual product quantities and legacy deltas', async () => {
    mocks.product.mockResolvedValue({ stock: 7, stockAdjustments: [] });
    expect(
      (await productPost(request({ quantity: 7, expectedQuantity: 10 }), context)).status,
    ).toBe(201);
    expect(mocks.product).toHaveBeenLastCalledWith('item', {
      quantity: 7,
      expectedQuantity: 10,
      reason: '',
    });
    expect((await productPost(request({ delta: -3, reason: 'legacy' }), context)).status).toBe(201);
  });

  it('rejects invalid counts and missing snapshots before writing', async () => {
    for (const body of [
      { quantity: -1, expectedQuantity: 0 },
      { quantity: 1.555, expectedQuantity: 0 },
      { quantity: 2 },
      { quantity: 2147483648, expectedQuantity: 0 },
    ]) {
      expect((await materialPost(request(body), context)).status).toBe(400);
    }
    expect(mocks.material).not.toHaveBeenCalled();
  });

  it('returns actionable conflicts for stale snapshots and concurrent transactions', async () => {
    mocks.material.mockRejectedValueOnce(new ApiError(409, 'STOCK_CHANGED'));
    const stale = await materialPost(request({ quantity: 7, expectedQuantity: 10 }), context);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'STOCK_CHANGED' });
    mocks.product.mockRejectedValueOnce(new ApiError(409, 'STOCK_CHANGED'));
    const conflict = await productPost(request({ quantity: 7, expectedQuantity: 10 }), context);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'STOCK_CHANGED' });
  });
});
