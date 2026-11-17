import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  materialFind: vi.fn(),
  materialCount: vi.fn(),
  productFind: vi.fn(),
  productCount: vi.fn(),
  recentMaterials: vi.fn(),
  recentCabochons: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/materials', () => ({
  materialInclude: { batchEntries: { include: { batch: true } } },
  serializeMaterial: (item: unknown) => item,
}));
vi.mock('@/lib/products', () => ({
  productInclude: {},
  serializeProduct: (item: unknown) => item,
}));
vi.mock('@/lib/catalog-list-filters', () => ({
  materialListWhere: async () => ({}),
  productListWhere: async () => ({}),
}));
import { batchWhere, listPickerCabochons, listPickerMaterials } from '@/lib/diy-picker/query';
import { pickerFiltersSchema } from '@/lib/diy-picker/contracts';
const ownerId = 'cm00000000000000000000001';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.materialFind.mockResolvedValue([]);
  mocks.productFind.mockResolvedValue([]);
  mocks.materialCount.mockResolvedValue(60);
  mocks.productCount.mockResolvedValue(60);
  mocks.recentMaterials.mockResolvedValue([]);
  mocks.recentCabochons.mockResolvedValue([]);
  mocks.transaction.mockImplementation((operation) =>
    operation({
      material: { findMany: mocks.materialFind, count: mocks.materialCount },
      product: { findMany: mocks.productFind, count: mocks.productCount },
      diyRecentMaterial: { findMany: mocks.recentMaterials },
      diyRecentCabochon: { findMany: mocks.recentCabochons },
    }),
  );
});
describe('DIY picker database filtering', () => {
  it('applies dimensions, stock and distributor to the same batch for inclusion and returned batches', async () => {
    const filters = pickerFiltersSchema.parse({
      lengthMin: 8,
      widthMax: 10,
      stock: 'available',
      distributorId: ownerId,
    });
    await listPickerMaterials(ownerId, filters);
    const call = mocks.materialFind.mock.calls[0][0];
    const condition = {
      lengthMm: { gte: 8 },
      widthMm: { lte: 10 },
      remainingQty: { gt: 0 },
      distributorId: ownerId,
    };
    expect(call.where.batchEntries).toEqual({ some: condition });
    expect(call.include.batchEntries.where).toEqual(condition);
    expect(mocks.materialCount).toHaveBeenCalledWith({ where: call.where });
  });
  it('keeps zero and unknown inventory in the default view and rejects reversed ranges', () => {
    expect(batchWhere(pickerFiltersSchema.parse({}))).toEqual({});
    expect(pickerFiltersSchema.safeParse({ lengthMin: 11, lengthMax: 10 }).success).toBe(false);
    expect(pickerFiltersSchema.safeParse({ heightMin: -1 }).success).toBe(false);
  });
  it('paginates past 50 items with stable ordering and reports the full matching count', async () => {
    const page = await listPickerMaterials(ownerId, pickerFiltersSchema.parse({ page: 3 }));
    expect(page).toMatchObject({ total: 60, page: 3, pageSize: 24 });
    expect(mocks.materialFind.mock.calls[0][0]).toMatchObject({
      skip: 48,
      take: 24,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    await listPickerCabochons(
      ownerId,
      pickerFiltersSchema.parse({ page: 3, excludeProductId: ownerId, lengthMin: 8 }),
    );
    expect(mocks.productFind.mock.calls[0][0]).toMatchObject({
      skip: 48,
      take: 24,
      where: {
        category: { name: '蛋面' },
        id: { not: ownerId },
        measurement: { is: { lengthMm: { gte: 8 } } },
      },
    });
  });
  it('restricts recent batches to the authenticated account and ranks grouped materials by latest use', async () => {
    mocks.recentMaterials.mockResolvedValue([
      { entryId: 'b-new' },
      { entryId: 'a-new' },
      { entryId: 'a-old' },
    ]);
    mocks.materialFind.mockResolvedValue([
      { id: 'a', batchEntries: [{ id: 'a-old' }, { id: 'a-new' }] },
      { id: 'b', batchEntries: [{ id: 'b-new' }] },
    ]);
    const page = await listPickerMaterials(
      ownerId,
      pickerFiltersSchema.parse({ source: 'recent' }),
    );
    expect(mocks.recentMaterials.mock.calls[0][0].where).toEqual({ ownerId });
    expect(mocks.materialFind.mock.calls[0][0].include.batchEntries.where.id).toEqual({
      in: ['b-new', 'a-new', 'a-old'],
    });
    expect(page.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(page.items[1].batchEntries.map((entry) => entry.id)).toEqual(['a-new', 'a-old']);
  });
  it('does not expose all candidates when an account has no history', async () => {
    await listPickerMaterials(ownerId, pickerFiltersSchema.parse({ source: 'recent' }));
    expect(mocks.materialFind.mock.calls[0][0].where.batchEntries.some.id).toEqual({ in: [] });
    await listPickerCabochons(ownerId, pickerFiltersSchema.parse({ source: 'recent' }));
    expect(mocks.productFind.mock.calls[0][0].where.AND).toContainEqual({ id: { in: [] } });
  });
});
