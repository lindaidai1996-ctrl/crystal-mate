import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  categories: vi.fn(),
  materials: vi.fn(),
  count: vi.fn(),
  aliases: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    materialCategory: { findMany: mocks.categories },
    material: { findMany: mocks.materials, count: mocks.count },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  },
}));
vi.mock('@/lib/catalog-search', () => ({ findAliasIds: mocks.aliases }));
vi.mock('@/lib/materials', () => ({
  materialInclude: {},
  serializeMaterial: (value: unknown) => value,
}));
import { GET } from '../../src/app/api/materials/route';

const silver = 'clx1234567890123456789012';
const clasp = 'clx1234567890123456789013';
const jade = 'clx1234567890123456789014';
const white = 'clx1234567890123456789015';
const categories = [
  { id: silver, name: 'S925银配饰', parentId: null },
  { id: clasp, name: '扣头', parentId: silver },
  { id: jade, name: '和田玉', parentId: null },
  { id: white, name: '冰白', parentId: jade },
];

function request(params: Record<string, string> = {}) {
  return GET(new NextRequest(`http://localhost/api/materials?${new URLSearchParams(params)}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.categories.mockResolvedValue(categories);
  mocks.materials.mockResolvedValue([{ id: 'material' }]);
  mocks.count.mockResolvedValue(23);
  mocks.aliases.mockResolvedValue([]);
});

describe('material category group API filters', () => {
  it.each<[string, string[]]>([
    ['silver', [silver, clasp]],
    ['hetian', [jade, white]],
  ])(
    'queries %s with matching descendants and identical list/count conditions',
    async (group, ids) => {
      const response = await request({
        categoryGroup: group,
        q: '扣头',
        source: 'IMAGE_IMPORT',
        createdFrom: '2026-11-01T00:00',
        createdTo: '2026-11-02T00:00',
        page: '2',
        pageSize: '20',
      });
      expect(response.status).toBe(200);
      const query = mocks.materials.mock.calls[0][0];
      expect(query).toMatchObject({
        skip: 20,
        take: 20,
        where: {
          categoryId: { in: ids },
          OR: [
            { name: { contains: '扣头', mode: 'insensitive' } },
            { id: { in: [] } },
            { tags: { some: { tag: { name: { contains: '扣头', mode: 'insensitive' } } } } },
          ],
          imageImportItems: { some: { entryId: { not: null } } },
          createdAt: {
            gte: new Date('2026-10-31T16:00:00Z'),
            lt: new Date('2026-11-01T16:01:00Z'),
          },
        },
      });
      expect(mocks.count).toHaveBeenCalledWith({ where: query.where });
      expect(await response.json()).toMatchObject({ total: 23, page: 2, pageSize: 20 });
    },
  );

  it.each([
    [silver, [silver, clasp]],
    [clasp, [clasp]],
    [jade, []],
  ])('intersects an explicit category %s with the group', async (categoryId, ids) => {
    expect((await request({ categoryGroup: 'silver', categoryId })).status).toBe(200);
    expect(mocks.materials.mock.calls[0][0].where.categoryId).toEqual({ in: ids });
  });

  it('returns an empty category condition instead of all materials when the group is missing', async () => {
    mocks.categories.mockResolvedValue(categories.slice(2));
    mocks.materials.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
    const response = await request({ categoryGroup: 'silver' });
    expect(mocks.materials.mock.calls[0][0].where.categoryId).toEqual({ in: [] });
    expect(await response.json()).toMatchObject({ items: [], total: 0 });
  });

  it('preserves ungrouped queries and existing category subtree behavior', async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(mocks.materials.mock.calls[0][0].where).not.toHaveProperty('categoryId');
    expect((await request({ categoryId: jade })).status).toBe(200);
    expect(mocks.materials.mock.calls[1][0].where.categoryId).toEqual({ in: [jade, white] });
  });

  it('rejects invalid groups, missing categories and unauthenticated queries', async () => {
    expect((await request({ categoryGroup: 'other' })).status).toBe(400);
    expect((await request({ categoryId: 'clx1234567890123456789099' })).status).toBe(400);
    mocks.auth.mockResolvedValue(null);
    expect((await request({ categoryGroup: 'silver' })).status).toBe(401);
    expect(mocks.materials).not.toHaveBeenCalled();
  });
});

describe('material search API filters', () => {
  it('includes names, aliases, and tag names in the DIY material search', async () => {
    mocks.aliases.mockResolvedValue(['alias-material']);

    expect((await request({ q: '和田玉' })).status).toBe(200);
    const where = mocks.materials.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { name: { contains: '和田玉', mode: 'insensitive' } },
      { id: { in: ['alias-material'] } },
      { tags: { some: { tag: { name: { contains: '和田玉', mode: 'insensitive' } } } } },
    ]);
    expect(mocks.aliases).toHaveBeenCalledWith('material', '和田玉');
    expect(mocks.count).toHaveBeenCalledWith({ where });
  });
});
