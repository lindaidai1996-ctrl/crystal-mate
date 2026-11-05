import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  measurementUpsert: vi.fn(),
  measurementDelete: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    product: { update: mocks.update },
    $transaction: (callback: (tx: object) => Promise<unknown>) =>
      callback({
        product: { findUnique: mocks.findUnique, update: mocks.update },
        cabochonMeasurement: {
          upsert: mocks.measurementUpsert,
          deleteMany: mocks.measurementDelete,
        },
      }),
  },
}));
vi.mock('@/lib/products', () => ({
  productInclude: {},
  saveProduct: vi.fn(),
  serializeProduct: vi.fn(),
}));

import { PATCH } from '../../src/app/api/products/[id]/route';

const context = { params: Promise.resolve({ id: 'product-1' }) };
const request = (body: object) =>
  new NextRequest('http://localhost/api/products/product-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.findUnique.mockResolvedValue({ category: { name: '蛋面' } });
  mocks.update.mockResolvedValue({ priceCents: 12345, updatedAt: new Date() });
});

describe('product quick edit API', () => {
  it('saves a price as a manual override without changing other product fields', async () => {
    const response = await PATCH(request({ field: 'price', priceCents: 12345 }), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { priceCents: 12345, saleManual: true },
      select: { priceCents: true, updatedAt: true },
    });
    expect(mocks.measurementUpsert).not.toHaveBeenCalled();
  });

  it('saves all three cabochon dimensions together', async () => {
    const measurement = { lengthMm: 11, widthMm: 12.5, heightMm: null };
    const response = await PATCH(request({ field: 'measurement', measurement }), context);
    expect(response.status).toBe(200);
    expect(mocks.measurementUpsert).toHaveBeenCalledWith({
      where: { productId: 'product-1' },
      create: { productId: 'product-1', ...measurement },
      update: measurement,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { updatedAt: expect.any(Date) },
      select: { updatedAt: true },
    });
  });

  it('clears the measurement record when all values are blank', async () => {
    const response = await PATCH(request({ field: 'measurement', measurement: null }), context);
    expect(response.status).toBe(200);
    expect(mocks.measurementDelete).toHaveBeenCalledWith({ where: { productId: 'product-1' } });
  });

  it('rejects dimensions on non-cabochon products', async () => {
    mocks.findUnique.mockResolvedValue({ category: { name: '手串' } });
    const response = await PATCH(
      request({ field: 'measurement', measurement: { lengthMm: 11 } }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.measurementUpsert).not.toHaveBeenCalled();
    expect(mocks.measurementDelete).not.toHaveBeenCalled();
  });

  it('rejects invalid values and unexpected fields', async () => {
    for (const body of [
      { field: 'price', priceCents: -1 },
      { field: 'price', priceCents: 100, stock: 0 },
      { field: 'measurement', measurement: { widthMm: 0 } },
    ]) {
      expect((await PATCH(request(body), context)).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
