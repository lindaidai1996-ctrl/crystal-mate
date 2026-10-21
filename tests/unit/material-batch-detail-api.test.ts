import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findBatch: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({ db: { materialBatch: { findUnique: mocks.findBatch } } }));

import { GET } from '../../src/app/api/material-batches/[id]/route';

const request = new NextRequest('http://localhost/api/material-batches/batch');
const context = { params: Promise.resolve({ id: 'batch' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
});

describe('material batch detail API', () => {
  it('requires admin authentication before reading batch images or pricing', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(401);
    expect(mocks.findBatch).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown batch', async () => {
    mocks.findBatch.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(404);
  });

  it('returns product image metadata and current sale prices while retaining purchase unit costs', async () => {
    const images = [
      { objectKey: 'images/product.png', url: '/api/images/product.png', position: 0 },
    ];
    mocks.findBatch.mockResolvedValue({
      id: 'batch',
      entries: [],
      attachments: [{ objectKey: 'images/receipt.png', notes: '采购凭证' }],
      productEntries: [
        {
          id: 'entry',
          unitCost: new Prisma.Decimal('12.5'),
          product: { id: 'product', code: 'A0001', name: '成品', priceCents: 0, images },
        },
      ],
    });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      attachments: [{ objectKey: 'images/receipt.png', notes: '采购凭证' }],
      productEntries: [
        {
          unitCost: '12.50',
          product: { priceCents: 0, images },
        },
      ],
    });
    expect(mocks.findBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          productEntries: expect.objectContaining({
            include: expect.objectContaining({
              product: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  priceCents: true,
                  images: { orderBy: { position: 'asc' } },
                },
              },
            }),
          }),
        }),
      }),
    );
  });
});
