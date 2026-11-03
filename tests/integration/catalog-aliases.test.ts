import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { name: 'admin' } }) }));

import { db } from '@/lib/db';
import { saveProduct } from '@/lib/products';
import { updateMaterialMaster } from '@/lib/materials';
import { productSchema, materialMasterSchema } from '@/lib/validation';
import { GET as getProducts } from '@/app/api/products/route';
import { GET as getMaterials } from '@/app/api/materials/route';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
const prefix = `alias-${crypto.randomUUID()}`;
let categoryId: string;
let materialCategoryId: string;

afterAll(async () => {
  if (categoryId) {
    const products = await db.product.findMany({ where: { categoryId }, select: { id: true } });
    await db.productDiyRun.deleteMany({
      where: { productId: { in: products.map(({ id }) => id) } },
    });
    await db.product.deleteMany({ where: { categoryId } });
    await db.productCode.deleteMany({ where: { categoryId } });
    await db.category.delete({ where: { id: categoryId } });
  }
  if (materialCategoryId) {
    await db.material.deleteMany({ where: { categoryId: materialCategoryId } });
    await db.materialCategory.delete({ where: { id: materialCategoryId } });
  }
  await db.$disconnect();
});

describe.skipIf(!enabled)('catalog alias persistence and search', () => {
  it('saves and edits aliases, preserves omitted fields, and searches substrings with filters and pagination', async () => {
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
    materialCategoryId = (await db.materialCategory.create({ data: { name: prefix } })).id;
    const input = {
      code: `ALIAS_${crypto.randomUUID()}`,
      name: '蓝色幽灵',
      aliases: [' 蓝色千层 ', 'Blue Phantom', 'blue phantom', ''],
      description: '',
      categoryId,
      priceCents: 100,
      currency: 'CNY',
      stock: 0,
      published: false,
      imageKeys: [],
      source: {
        origin: 'DIY',
        quantity: 1,
        notes: '',
        materials: [],
        cabochons: [],
        extraCosts: [{ name: '成本', amount: '1.00' }],
      },
    };
    const created = await saveProduct(productSchema.parse(input));
    expect(created.aliases).toEqual(['蓝色千层', 'Blue Phantom']);
    const material = await db.material.create({
      data: {
        name: '蓝色幽灵',
        aliases: created.aliases,
        categoryId: materialCategoryId,
      },
    });

    for (const [handler, path, filter, id] of [
      [getProducts, 'products', categoryId, created.id],
      [getMaterials, 'materials', materialCategoryId, material.id],
    ] as const) {
      for (const query of ['千层', 'pHaNtOm', '幽灵']) {
        const response = await handler(
          new NextRequest(
            `http://localhost/api/${path}?categoryId=${filter}&q=${encodeURIComponent(query)}&pageSize=1`,
          ),
        );
        expect(response.status).toBe(200);
        const page = await response.json();
        expect(page.total).toBe(1);
        expect(page.items.map((item: { id: string }) => item.id)).toEqual([id]);
      }
      const outside = await handler(
        new NextRequest(
          `http://localhost/api/${path}?categoryId=${filter}&q=${encodeURIComponent('千层')}&page=2&pageSize=1`,
        ),
      );
      expect(await outside.json()).toMatchObject({ total: 1, items: [] });
      const noMatch = await handler(
        new NextRequest(
          `http://localhost/api/${path}?categoryId=${filter}&q=${encodeURIComponent("%_' OR 1=1")}`,
        ),
      );
      expect(await noMatch.json()).toMatchObject({ total: 0, items: [] });
    }

    const { source: _source, aliases: _aliases, ...edit } = input;
    void _source;
    void _aliases;
    expect((await saveProduct(productSchema.parse(edit), created.id)).aliases).toEqual(
      created.aliases,
    );
    const updated = await saveProduct(
      productSchema.parse({ ...edit, aliases: ['新叫法'] }),
      created.id,
    );
    expect(updated.aliases).toEqual(['新叫法']);
    const master = {
      name: material.name,
      categoryId: materialCategoryId,
      unit: material.unit,
      notes: '',
    };
    expect(
      (await updateMaterialMaster(material.id, materialMasterSchema.parse(master))).aliases,
    ).toEqual(created.aliases);
    expect(
      (
        await updateMaterialMaster(
          material.id,
          materialMasterSchema.parse({ ...master, aliases: [] }),
        )
      ).aliases,
    ).toEqual([]);
  });
});
