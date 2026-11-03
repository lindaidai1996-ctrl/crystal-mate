import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));

import { db } from '@/lib/db';
import { saveProduct } from '@/lib/products';
import { productSchema } from '@/lib/validation';
import { GET, POST } from '@/app/api/setting-styles/route';
import { DELETE as deleteProduct } from '@/app/api/products/[id]/route';
import { PUT as updateCategory } from '@/app/api/categories/[id]/route';
import { reserveProductCode } from '@/lib/product-code-store';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
const suffix = crypto.randomUUID();
const productIds: string[] = [];
const styleIds: string[] = [];
const categoryIds: string[] = [];

afterAll(async () => {
  if (enabled) {
    await db.productDiyRun.deleteMany({ where: { productId: { in: productIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.productCode.deleteMany({ where: { categoryId: { in: categoryIds } } });
    await db.settingStyle.deleteMany({ where: { id: { in: styleIds } } });
    await db.category.deleteMany({ where: { id: { in: categoryIds } } });
  }
  await db.$disconnect();
});

const url = 'http://localhost/api/setting-styles';
function createStyle(magicBoxStyle: string, origin = 'http://localhost') {
  return POST(
    new NextRequest(url, {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify({ magicBoxStyle }),
    }),
  );
}

describe.skipIf(!enabled)('setting styles and cabochon extra information', () => {
  it('protects style management and validates blank and duplicate names', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect((await createStyle('未授权款式')).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
    expect((await createStyle('跨域款式', 'http://other.test')).status).toBe(403);
    expect((await createStyle('  ')).status).toBe(400);
    expect((await createStyle('长'.repeat(61))).status).toBe(400);
    const response = await createStyle(`  素边魔盒-${suffix}  `);
    expect(response.status).toBe(201);
    const style = await response.json();
    styleIds.push(style.id);
    expect(style).toMatchObject({ magicBoxStyle: `素边魔盒-${suffix}`, productCount: 0 });
    expect((await createStyle(style.magicBoxStyle)).status).toBe(409);
  });

  it('round-trips styles, counts products, preserves history, and updates counts on clear, reclassification and deletion', async () => {
    mocks.auth.mockResolvedValue({ user: { name: 'admin' } });
    const existing = await db.category.findUnique({ where: { name: '蛋面' } });
    const eggCategory = existing ?? (await db.category.create({ data: { name: '蛋面' } }));
    if (!existing) categoryIds.push(eggCategory.id);
    const otherCategory = await db.category.create({
      data: { name: `镶嵌测试-${suffix}`, prefix: 'SETTINGTEST' },
    });
    categoryIds.push(otherCategory.id);
    const styles = await Promise.all(
      ['四爪', '花边'].map((name) =>
        db.settingStyle.create({ data: { magicBoxStyle: `${name}-${suffix}` } }),
      ),
    );
    styleIds.push(...styles.map((item) => item.id));
    const base = {
      name: '镶嵌测试蛋面',
      description: '',
      categoryId: eggCategory.id,
      priceCents: 100,
      currency: 'CNY' as const,
      stock: 0,
      published: false,
      imageKeys: [],
    };
    const legacy = await db.product.create({
      data: {
        code: `SETTING-LEGACY-${suffix}`,
        name: '历史蛋面',
        categoryId: eggCategory.id,
        priceCents: 100,
        stock: 9,
      },
    });
    productIds.push(legacy.id);
    const created = await saveProduct(
      productSchema.parse({
        ...base,
        code: `SETTING-NEW-${suffix}`,
        source: {
          origin: 'DIY',
          quantity: 1,
          notes: '',
          materials: [],
          cabochons: [],
          extraCosts: [{ name: '成本', amount: '1' }],
        },
      }),
    );
    productIds.push(created.id);
    expect(created.extraInfo).toMatchObject({ settingStyleId: null, settingStyle: null });
    expect(await db.cabochonExtraInfo.findUnique({ where: { productId: legacy.id } })).toBeNull();
    const edit = { ...base, code: legacy.code };
    await saveProduct(productSchema.parse(edit), legacy.id);
    expect(await db.cabochonExtraInfo.findUnique({ where: { productId: legacy.id } })).toBeNull();

    async function counts() {
      const response = await GET(new NextRequest(url));
      expect(response.status).toBe(200);
      const items = (await response.json()) as { id: string; productCount: number }[];
      return styles.map((style) => items.find((item) => item.id === style.id)!.productCount);
    }
    const assigned = await saveProduct(
      productSchema.parse({ ...edit, extraInfo: { settingStyleId: styles[0].id } }),
      legacy.id,
    );
    expect(assigned.extraInfo?.settingStyle).toMatchObject(styles[0]);
    await saveProduct(
      productSchema.parse({
        ...base,
        code: created.code,
        extraInfo: { settingStyleId: styles[0].id },
      }),
      created.id,
    );
    // Counts are product records, including unpublished or zero-stock products, not stock units.
    expect(await counts()).toEqual([2, 0]);
    await saveProduct(productSchema.parse(edit), legacy.id);
    expect(await counts()).toEqual([2, 0]);
    await saveProduct(
      productSchema.parse({ ...edit, extraInfo: { settingStyleId: styles[1].id } }),
      legacy.id,
    );
    expect(await counts()).toEqual([1, 1]);
    const cleared = await saveProduct(
      productSchema.parse({ ...edit, extraInfo: { settingStyleId: null } }),
      legacy.id,
    );
    expect(cleared.extraInfo).toMatchObject({ settingStyleId: null, settingStyle: null });
    expect(await counts()).toEqual([1, 0]);
    await expect(
      saveProduct(
        productSchema.parse({
          ...edit,
          extraInfo: { settingStyleId: 'clx1234567890123456789011' },
        }),
        legacy.id,
      ),
    ).rejects.toMatchObject({ code: 'SETTING_STYLE_NOT_FOUND' });
    expect(await counts()).toEqual([1, 0]);

    const rename = await updateCategory(
      new NextRequest(`http://localhost/api/categories/${eggCategory.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: `改名-${suffix}` }),
      }),
      { params: Promise.resolve({ id: eggCategory.id }) },
    );
    expect(rename.status).toBe(409);
    expect(await rename.json()).toMatchObject({ error: 'CABOCHON_EXTRA_INFO_IN_USE' });

    await saveProduct(
      productSchema.parse({ ...edit, extraInfo: { settingStyleId: styles[1].id } }),
      legacy.id,
    );
    expect(await counts()).toEqual([1, 1]);
    const reservation = await reserveProductCode(otherCategory.id);
    const reclassified = { ...edit, categoryId: otherCategory.id, code: reservation.code };
    await expect(
      saveProduct(
        productSchema.parse({
          ...reclassified,
          extraInfo: { settingStyleId: styles[0].id },
        }),
        legacy.id,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await saveProduct(
      productSchema.parse({
        ...reclassified,
        codeReservationToken: reservation.reservationToken,
      }),
      legacy.id,
    );
    expect(await db.cabochonExtraInfo.findUnique({ where: { productId: legacy.id } })).toBeNull();
    expect(await counts()).toEqual([1, 0]);
    const deleted = await deleteProduct(
      new NextRequest(`http://localhost/api/products/${created.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(deleted.status).toBe(204);
    expect(await counts()).toEqual([0, 0]);
    expect(await db.cabochonExtraInfo.findUnique({ where: { productId: created.id } })).toBeNull();
  });
});
