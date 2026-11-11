import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productGroups: vi.fn(),
  materialGroups: vi.fn(),
  categories: vi.fn(),
  aliases: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    product: { groupBy: mocks.productGroups },
    material: { groupBy: mocks.materialGroups },
    materialCategory: { findMany: mocks.categories },
  },
}));
vi.mock('@/lib/catalog-search', () => ({ findAliasIds: mocks.aliases }));

import { GET as products } from '../../src/app/api/products/category-counts/route';
import { GET as materials } from '../../src/app/api/materials/category-counts/route';

const silver = 'clx1234567890123456789012';
const clasp = 'clx1234567890123456789013';
const smallClasp = 'clx1234567890123456789014';
const jade = 'clx1234567890123456789015';
const empty = 'clx1234567890123456789016';
const categories = [
  { id: silver, name: 'S925银配饰', parentId: null },
  { id: clasp, name: '扣头', parentId: silver },
  { id: smallClasp, name: '小扣头', parentId: clasp },
  { id: jade, name: '和田玉', parentId: null },
  { id: empty, name: '空分类', parentId: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.aliases.mockResolvedValue(['alias-match']);
  mocks.categories.mockResolvedValue(categories);
  mocks.productGroups.mockResolvedValue([]);
  mocks.materialGroups.mockResolvedValue([]);
});

describe('product category counts', () => {
  it('counts records across categories while retaining all other filters and the finished-strands scope', async () => {
    mocks.productGroups.mockResolvedValue([
      { categoryId: 'ring', _count: { _all: 3 } },
      { categoryId: 'earring', _count: { _all: 7 } },
    ]);
    const params = new URLSearchParams({
      q: '耳环',
      categoryId: 'ring',
      excludeCategoryName: '蛋面',
      tagId: silver,
      origin: 'DIY',
      published: 'false',
      stock: '1',
      createdFrom: '2026-11-01T00:00',
      createdTo: '2026-11-02T00:00',
      page: '3',
      pageSize: '1',
      sortPrice: 'asc',
    });
    const response = await products(
      new NextRequest(`http://localhost/api/products/category-counts?${params}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: 10, byCategory: { ring: 3, earring: 7 } });
    expect(mocks.productGroups).toHaveBeenCalledExactlyOnceWith({
      by: ['categoryId'],
      _count: { _all: true },
      where: {
        OR: [
          { name: { contains: '耳环', mode: 'insensitive' } },
          { code: { contains: '耳环', mode: 'insensitive' } },
          { id: { in: ['alias-match'] } },
        ],
        category: { name: { not: '蛋面' } },
        tags: { some: { tagId: silver } },
        origin: 'DIY',
        published: false,
        stock: { gt: 0 },
        createdAt: {
          gte: new Date('2026-10-31T16:00:00Z'),
          lt: new Date('2026-11-01T16:01:00Z'),
        },
      },
    });
  });
});

describe('material category counts', () => {
  it('includes direct records and all descendants without double-counting the total', async () => {
    mocks.materialGroups.mockResolvedValue([
      { categoryId: silver, _count: { _all: 2 } },
      { categoryId: clasp, _count: { _all: 3 } },
      { categoryId: smallClasp, _count: { _all: 5 } },
      { categoryId: jade, _count: { _all: 7 } },
    ]);
    const response = await materials(
      new NextRequest(
        'http://localhost/api/materials/category-counts?categoryId=ignored&q=扣头&source=OTHER',
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      total: 17,
      byCategory: { [silver]: 10, [clasp]: 8, [smallClasp]: 5, [jade]: 7, [empty]: 0 },
    });
    const query = mocks.materialGroups.mock.calls[0][0];
    expect(query.where).not.toHaveProperty('categoryId');
    expect(query.where).toEqual({
      OR: [
        { name: { contains: '扣头', mode: 'insensitive' } },
        { id: { in: ['alias-match'] } },
        { tags: { some: { tag: { name: { contains: '扣头', mode: 'insensitive' } } } } },
      ],
      imageImportItems: { none: { entryId: { not: null } } },
    });
  });

  it('retains the category group and time range independently of the selected category', async () => {
    const response = await materials(
      new NextRequest(
        `http://localhost/api/materials/category-counts?categoryId=${jade}&categoryGroup=silver&source=IMAGE_IMPORT&createdFrom=2026-11-01T00:00`,
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.categories).toHaveBeenCalledTimes(1);
    expect(mocks.materialGroups.mock.calls[0][0].where).toEqual({
      categoryId: { in: [silver, clasp, smallClasp] },
      imageImportItems: { some: { entryId: { not: null } } },
      createdAt: { gte: new Date('2026-10-31T16:00:00Z') },
    });
    expect(await response.json()).toMatchObject({ total: 0 });
  });
});

describe('category count authorization and validation', () => {
  it.each([products, materials])(
    'requires an administrator before reading data',
    async (handler) => {
      mocks.auth.mockResolvedValue(null);
      expect((await handler(new NextRequest('http://localhost/api/counts'))).status).toBe(401);
      expect(mocks.productGroups).not.toHaveBeenCalled();
      expect(mocks.materialGroups).not.toHaveBeenCalled();
      expect(mocks.categories).not.toHaveBeenCalled();
    },
  );

  it.each([products, materials])('rejects invalid dates before reading data', async (handler) => {
    const response = await handler(
      new NextRequest('http://localhost/api/counts?createdFrom=2026-02-30T00:00'),
    );
    expect(response.status).toBe(400);
    expect(mocks.productGroups).not.toHaveBeenCalled();
    expect(mocks.materialGroups).not.toHaveBeenCalled();
    expect(mocks.categories).not.toHaveBeenCalled();
  });

  it.each([products, materials])('returns zero for an empty result', async (handler) => {
    const response = await handler(new NextRequest('http://localhost/api/counts'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0 });
  });
});
