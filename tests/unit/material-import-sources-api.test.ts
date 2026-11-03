import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  material: vi.fn(),
  sources: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    material: { findUnique: mocks.material, findMany: mocks.list, count: mocks.count },
    materialImageImportItem: { findMany: mocks.sources },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  },
}));
vi.mock('@/lib/catalog-search', () => ({ findAliasIds: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/materials', () => ({
  materialInclude: {},
  serializeMaterial: (item: unknown) => item,
}));

import { GET as sources } from '@/app/api/materials/[id]/image-imports/route';
import { GET as list } from '@/app/api/materials/route';

const request = new NextRequest('http://localhost/api/materials/material-1/image-imports');
const context = { params: Promise.resolve({ id: 'material-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
  mocks.material.mockResolvedValue({ id: 'material-1' });
  mocks.sources.mockResolvedValue([]);
  mocks.list.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
});

describe('material image import sources', () => {
  it('requires authentication before reading sources or original images', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await sources(request, context)).status).toBe(401);
    expect(mocks.material).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing material and an empty list for a material without image imports', async () => {
    mocks.material.mockResolvedValueOnce(null);
    expect((await sources(request, context)).status).toBe(404);
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(await (await sources(request, context)).json()).toEqual([]);
  });

  it('returns committed sources including archived imports without leaking draft contents', async () => {
    const createdAt = new Date('2026-10-26T01:00:00.000Z');
    const archivedAt = new Date('2026-10-26T02:00:00.000Z');
    mocks.sources.mockResolvedValue([
      {
        id: 'item-1',
        import: {
          id: 'import-1',
          fileName: '报价图.png',
          sourceUrl: '/source.png',
          createdAt,
          archivedAt,
        },
        entry: {
          id: 'entry-1',
          createdAt,
          batch: { id: 'batch-1', name: '批次一' },
          distributor: { id: 'supplier-1', name: '供应商一' },
        },
      },
      { id: 'deleted-entry', entry: null },
    ]);
    const response = await sources(request, context);
    expect(await response.json()).toEqual([
      {
        itemId: 'item-1',
        importId: 'import-1',
        fileName: '报价图.png',
        sourceUrl: '/source.png',
        importedAt: createdAt.toISOString(),
        archivedAt: archivedAt.toISOString(),
        entryId: 'entry-1',
        receivedAt: createdAt.toISOString(),
        batch: { id: 'batch-1', name: '批次一' },
        distributor: { id: 'supplier-1', name: '供应商一' },
      },
    ]);
    expect(mocks.sources).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materialId: 'material-1', entryId: { not: null } },
      }),
    );
  });

  it.each([
    ['IMAGE_IMPORT', 'some'],
    ['OTHER', 'none'],
  ])('filters %s using committed source relations', async (source, operator) => {
    const response = await list(new NextRequest(`http://localhost/api/materials?source=${source}`));
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { imageImportItems: { [operator]: { entryId: { not: null } } } },
      }),
    );
    expect(mocks.count).toHaveBeenCalledWith({
      where: { imageImportItems: { [operator]: { entryId: { not: null } } } },
    });
  });

  it('rejects an unsupported source filter', async () => {
    expect(
      (await list(new NextRequest('http://localhost/api/materials?source=unknown'))).status,
    ).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
