import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  products: vi.fn(),
  productCount: vi.fn(),
  materials: vi.fn(),
  materialCount: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    product: { findMany: mocks.products, count: mocks.productCount },
    material: { findMany: mocks.materials, count: mocks.materialCount },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  },
}));
vi.mock('@/lib/catalog-search', () => ({ findAliasIds: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/products', () => ({
  productInclude: {},
  serializeProduct: (value: unknown) => value,
}));
vi.mock('@/lib/materials', () => ({
  materialInclude: {},
  serializeMaterial: (value: unknown) => value,
}));
import { GET as products } from '../../src/app/api/products/route';
import { GET as materials } from '../../src/app/api/materials/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.products.mockResolvedValue([]);
  mocks.materials.mockResolvedValue([]);
  mocks.productCount.mockResolvedValue(0);
  mocks.materialCount.mockResolvedValue(0);
});

describe('list creation-time API filters', () => {
  it.each([
    {
      handler: products,
      list: mocks.products,
      count: mocks.productCount,
      extra: { excludeCategoryName: '蛋面', stock: '1' },
      expected: { category: { name: { not: '蛋面' } }, stock: { gt: 0 } },
    },
    {
      handler: products,
      list: mocks.products,
      count: mocks.productCount,
      extra: { categoryId: 'cabochon-category' },
      expected: { categoryId: 'cabochon-category' },
    },
    {
      handler: materials,
      list: mocks.materials,
      count: mocks.materialCount,
      extra: { source: 'IMAGE_IMPORT' },
      expected: { imageImportItems: { some: { entryId: { not: null } } } },
    },
  ])(
    'combines dates with existing filters and uses the same condition for items and total',
    async ({ handler, list, count, extra, expected }) => {
      const params = new URLSearchParams({
        createdFrom: '2026-10-26T10:15',
        createdTo: '2026-10-27T18:30',
        page: '2',
        pageSize: '20',
      });
      for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined) params.set(key, value);
      }
      const response = await handler(new NextRequest(`http://localhost/api/list?${params}`));
      expect(response.status).toBe(200);
      const createdAt = {
        gte: new Date('2026-10-26T02:15:00Z'),
        lt: new Date('2026-10-27T10:31:00Z'),
      };
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdAt, ...expected }),
          skip: 20,
          take: 20,
        }),
      );
      expect(count).toHaveBeenCalledWith({ where: list.mock.calls[0][0].where });
      expect(await response.json()).toMatchObject({ total: 0, page: 2, pageSize: 20 });
    },
  );

  it.each([products, materials])(
    'rejects malformed and reversed ranges before database reads',
    async (handler) => {
      for (const range of [
        { createdFrom: '2026-02-30T12:00' },
        { createdFrom: '2026-10-28T12:00', createdTo: '2026-10-27T12:00' },
      ]) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(range)) {
          if (value !== undefined) params.set(key, value);
        }
        const response = await handler(new NextRequest(`http://localhost/api/list?${params}`));
        expect(response.status).toBe(400);
      }
      expect(mocks.products).not.toHaveBeenCalled();
      expect(mocks.materials).not.toHaveBeenCalled();
    },
  );

  it.each([
    { handler: products, list: mocks.products },
    { handler: materials, list: mocks.materials },
  ])(
    'leaves existing queries unrestricted when the range is cleared',
    async ({ handler, list }) => {
      expect((await handler(new NextRequest('http://localhost/api/list'))).status).toBe(200);
      expect(list.mock.calls[0][0].where).not.toHaveProperty('createdAt');
    },
  );
});

describe('product price sorting', () => {
  it.each([
    ['asc', 'asc'],
    ['desc', 'desc'],
  ] as const)('sorts the full result before paginating (%s)', async (param, order) => {
    const response = await products(
      new NextRequest(`http://localhost/api/products?sortPrice=${param}&page=2&pageSize=20`),
    );
    expect(response.status).toBe(200);
    expect(mocks.products).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ priceCents: order }, { id: 'asc' }],
        skip: 20,
        take: 20,
      }),
    );
  });

  it('rejects unsupported sort values', async () => {
    const response = await products(
      new NextRequest('http://localhost/api/products?sortPrice=random'),
    );
    expect(response.status).toBe(400);
    expect(mocks.products).not.toHaveBeenCalled();
  });
});

describe('product origin filtering', () => {
  it.each(['PURCHASED', 'DIY'] as const)('filters items and total by %s', async (origin) => {
    const response = await products(
      new NextRequest(`http://localhost/api/products?origin=${origin}&page=2`),
    );
    expect(response.status).toBe(200);
    expect(mocks.products).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ origin }), skip: 20 }),
    );
    expect(mocks.productCount).toHaveBeenCalledWith({
      where: mocks.products.mock.calls[0][0].where,
    });
  });

  it('rejects unsupported origins', async () => {
    const response = await products(new NextRequest('http://localhost/api/products?origin=OTHER'));
    expect(response.status).toBe(400);
    expect(mocks.products).not.toHaveBeenCalled();
  });
});

describe('cabochon marketing filters', () => {
  it('combines stock and marketing progress with the same conditions for rows and total', async () => {
    const response = await products(
      new NextRequest(
        'http://localhost/api/products?stock=1&videoShot=true&xiaohongshuVideoPublished=false&xiaohongshuListed=true',
      ),
    );
    expect(response.status).toBe(200);
    const where = mocks.products.mock.calls[0][0].where;
    expect(where).toMatchObject({
      stock: { gt: 0 },
      AND: [
        { marketing: { is: { videoShot: true } } },
        {
          OR: [
            { marketing: { is: null } },
            { marketing: { is: { xiaohongshuVideoPublished: false } } },
          ],
        },
        { marketing: { is: { xiaohongshuListed: true } } },
      ],
    });
    expect(mocks.productCount).toHaveBeenCalledWith({ where });
  });

  it('retains the unset-setting filter alongside incomplete marketing progress', async () => {
    const response = await products(
      new NextRequest('http://localhost/api/products?settingStyleId=unset&videoShot=false'),
    );
    expect(response.status).toBe(200);
    expect(mocks.products.mock.calls[0][0].where.AND).toEqual([
      {
        OR: [{ extraInfo: { is: null } }, { extraInfo: { is: { settingStyleId: null } } }],
      },
      {
        OR: [{ marketing: { is: null } }, { marketing: { is: { videoShot: false } } }],
      },
    ]);
  });

  it('rejects invalid progress values before database reads', async () => {
    const response = await products(
      new NextRequest('http://localhost/api/products?xiaohongshuListed=pending'),
    );
    expect(response.status).toBe(400);
    expect(mocks.products).not.toHaveBeenCalled();
  });
});
