import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { emptyCardBrand } from '@/lib/product-cards/contracts';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  validate: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock('@/lib/db', () => ({
  db: { productCardBrandSettings: { findUnique: mocks.find }, $transaction: mocks.transaction },
}));
vi.mock('@/lib/products', () => ({
  productInclude: {},
  serializeProduct: (value: unknown) => value,
}));
vi.mock('@/lib/product-cards/assets', () => ({
  copyProductCardImage: vi.fn(),
  validateBrandAssets: mocks.validate,
}));
import { getBrand, saveBrand } from '@/lib/product-cards/service';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(null);
  mocks.create.mockResolvedValue({});
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.validate.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation((work) =>
    work({
      productCardBrandSettings: {
        findUnique: mocks.find,
        create: mocks.create,
        updateMany: mocks.update,
      },
    }),
  );
});
describe('reusable card brand defaults', () => {
  it('uses existing brand text before defaults are configured and persists explicit defaults', async () => {
    expect(await getBrand()).toMatchObject({ brand: { name: '祝余 IWISH' }, version: 0 });
    expect(await saveBrand({ ...emptyCardBrand, name: '新品牌' }, 0)).toMatchObject({
      brand: { name: '新品牌' },
      version: 1,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { id: 'default', data: { ...emptyCardBrand, name: '新品牌' }, version: 1 },
    });
  });
  it('checks asset kind and revision when updating shared defaults', async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(saveBrand(emptyCardBrand, 5)).rejects.toMatchObject({ code: 'CARD_CONFLICT' });
    expect(mocks.validate).toHaveBeenCalledWith([null, null]);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'default', version: 5 },
      data: { data: emptyCardBrand, version: { increment: 1 } },
    });
  });
  it('reports a concurrent initial save as a revision conflict', async () => {
    mocks.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(saveBrand(emptyCardBrand, 0)).rejects.toMatchObject({ code: 'CARD_CONFLICT' });
  });
});
