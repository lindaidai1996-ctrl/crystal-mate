import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));

import { db } from '../../src/lib/db';
import { reserveProductCode } from '../../src/lib/product-code-store';
import { saveProduct } from '../../src/lib/products';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
const categoryIds: string[] = [];

async function category() {
  const prefix = `TEST${[...randomBytes(10)]
    .map((byte) => String.fromCharCode(65 + (byte % 26)))
    .join('')}`;
  const result = await db.category.create({ data: { name: prefix, prefix } });
  categoryIds.push(result.id);
  return result;
}

function input(categoryId: string, code: string, codeReservationToken?: string) {
  return {
    categoryId,
    code,
    codeReservationToken,
    name: '编码测试商品',
    description: '',
    priceCents: 100,
    currency: 'CNY' as const,
    stock: 0,
    published: false,
    imageKeys: [],
  };
}

const source = {
  origin: 'DIY' as const,
  quantity: 1,
  notes: '',
  materials: [],
  cabochons: [],
  extraCosts: [{ name: '测试成本', amount: '1.00' }],
};

async function removeProduct(id: string) {
  await db.productDiyRun.deleteMany({ where: { productId: id } });
  await db.product.delete({ where: { id } });
}

afterAll(async () => {
  if (enabled) {
    const products = await db.product.findMany({
      where: { categoryId: { in: categoryIds } },
      select: { id: true },
    });
    for (const product of products) await removeProduct(product.id);
    await db.productCode.deleteMany({ where: { categoryId: { in: categoryIds } } });
    await db.category.deleteMany({ where: { id: { in: categoryIds } } });
  }
  await db.$disconnect();
});

describe.skipIf(!enabled)('permanent product code allocation', () => {
  it('moves a product to its new category without recycling its old number or changing its source', async () => {
    const a = await category();
    const b = await category();
    const originalCode = `${a.prefix}0012`;
    const product = await saveProduct({ ...input(a.id, originalCode), source });
    const reservation = await reserveProductCode(b.id);
    expect(reservation.code).toBe(`${b.prefix}0001`);
    const moved = await saveProduct(
      input(b.id, reservation.code, reservation.reservationToken),
      product.id,
    );
    expect(moved).toMatchObject({ id: product.id, categoryId: b.id, code: reservation.code });
    expect(moved.diyRuns.map((run) => run.id)).toEqual(product.diyRuns.map((run) => run.id));
    expect(moved.stock).toBe(product.stock);
    expect((await reserveProductCode(a.id)).code).toBe(`${a.prefix}0013`);
    await expect(saveProduct({ ...input(a.id, originalCode), source })).rejects.toMatchObject({
      code: 'PRODUCT_CODE_USED',
    });
    const edited = await saveProduct({ ...input(b.id, moved.code), name: '只改名称' }, moved.id);
    expect(edited.code).toBe(moved.code);
  });

  it('keeps abandoned reservations and deleted products out of future allocations', async () => {
    const a = await category();
    await reserveProductCode(a.id);
    const second = await reserveProductCode(a.id);
    expect(second.code).toBe(`${a.prefix}0002`);
    const product = await saveProduct({
      ...input(a.id, second.code, second.reservationToken),
      source,
    });
    await removeProduct(product.id);
    expect((await reserveProductCode(a.id)).code).toBe(`${a.prefix}0003`);
    await db.category.delete({ where: { id: a.id } });
    const recreated = await db.category.create({ data: { name: a.name, prefix: a.prefix } });
    categoryIds.push(recreated.id);
    expect((await reserveProductCode(recreated.id)).code).toBe(`${a.prefix}0004`);
  });

  it('requires a valid reservation when changing categories, even for requests that keep the old code', async () => {
    const a = await category();
    const b = await category();
    const product = await saveProduct({ ...input(a.id, `${a.prefix}0001`), source });
    for (const code of [product.code, `${b.prefix}0001`]) {
      await expect(saveProduct(input(b.id, code), product.id)).rejects.toMatchObject({
        code: 'PRODUCT_CODE_REGENERATE',
      });
    }
    expect(await db.product.findUnique({ where: { id: product.id } })).toMatchObject({
      categoryId: a.id,
      code: product.code,
    });
  });

  it('rejects reservations for another category or an outdated category prefix', async () => {
    const a = await category();
    const b = await category();
    const reserved = await reserveProductCode(a.id);
    await expect(
      saveProduct({ ...input(b.id, reserved.code, reserved.reservationToken), source }),
    ).rejects.toMatchObject({ code: 'PRODUCT_CODE_REGENERATE' });
    await db.category.update({ where: { id: a.id }, data: { prefix: `${a.prefix}X` } });
    await expect(
      saveProduct({ ...input(a.id, reserved.code, reserved.reservationToken), source }),
    ).rejects.toMatchObject({ code: 'PRODUCT_CODE_REGENERATE' });
    expect((await reserveProductCode(a.id)).code).toBe(`${a.prefix}X0001`);
  });

  it('allocates distinct increasing numbers under concurrent requests', async () => {
    const a = await category();
    const results = await Promise.all(Array.from({ length: 6 }, () => reserveProductCode(a.id)));
    expect(results.map((result) => result.code).sort()).toEqual(
      Array.from({ length: 6 }, (_, index) => `${a.prefix}000${index + 1}`),
    );
    expect(new Set(results.map((result) => result.reservationToken)).size).toBe(6);
  });

  it('preserves a reservation on failed save and prevents a second product from claiming it', async () => {
    const a = await category();
    const reserved = await reserveProductCode(a.id);
    const data = input(a.id, reserved.code, reserved.reservationToken);
    await expect(
      saveProduct({ ...data, source, tagIds: ['clx1234567890123456789012'] }),
    ).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' });
    expect(await db.productCode.findUnique({ where: { code: data.code } })).toMatchObject({
      productId: null,
      reservationToken: reserved.reservationToken,
    });
    const product = await saveProduct({ ...data, source });
    expect(await db.productCode.findUnique({ where: { code: data.code } })).toMatchObject({
      productId: product.id,
      reservationToken: null,
    });
    await expect(saveProduct({ ...data, source })).rejects.toMatchObject({
      code: 'PRODUCT_CODE_REGENERATE',
    });
  });

  it('advances past a manually assigned number and never fills earlier gaps at exhaustion', async () => {
    const a = await category();
    const product = await saveProduct({ ...input(a.id, `${a.prefix}0042`), source });
    expect((await reserveProductCode(a.id)).code).toBe(`${a.prefix}0043`);
    await saveProduct(input(a.id, `${a.prefix}9999`), product.id);
    await removeProduct(product.id);
    await expect(reserveProductCode(a.id)).rejects.toMatchObject({ code: 'CODE_EXHAUSTED' });
  });
});
