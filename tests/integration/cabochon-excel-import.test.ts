import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { db } from '@/lib/db';
import {
  emptyExcelValues,
  excelRowInputSchema,
  type ExcelImport,
} from '@/lib/cabochonExcelImport/contracts';
import {
  commitExcelRow,
  createExcelImport,
  getExcelImport,
  listExcelImports,
  updateExcelRow,
} from '@/lib/cabochonExcelImport/store';
import { saveProduct } from '@/lib/products';
import { reserveProductCode } from '@/lib/product-code-store';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL!).pathname.endsWith('_test');
const suffix = crypto.randomUUID();
const jobs: string[] = [];
const products: string[] = [];
const grants: string[] = [];
const styleNames: string[] = [];
const extraTagIds: string[] = [];
let categoryId: string;
let tagId: string;
let styleId: string;
let createdCategory = false;
async function draft(values = {}, withImage = false) {
  const key = `cabochons/images/${crypto.randomUUID()}.png`;
  if (withImage) {
    grants.push(key);
    await db.uploadGrant.create({
      data: {
        objectKey: key,
        url: `/api/images/${key}`,
        uploadedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  }
  const input = {
    id: crypto.randomUUID(),
    fileHash: 'a'.repeat(64),
    fileName: '蛋面.xlsx',
    sheetName: '库存',
    rows: [
      excelRowInputSchema.parse({
        rowNumber: 2,
        values: { ...emptyExcelValues(), ...values },
        original: [{ column: 'A 编号', value: 'OLD-01' }],
        imageKeys: withImage ? [key] : [],
        imageErrors: [],
      }),
    ],
  };
  const job = await createExcelImport(input);
  jobs.push(job.id);
  return { job, input };
}
async function commit(job: ExcelImport) {
  const result = await commitExcelRow(job.id, 2, job.version);
  products.push(result.rows[0].receipt!.productId);
  return result;
}
beforeAll(async () => {
  if (!enabled) return;
  let category = await db.category.findUnique({ where: { name: '蛋面' } });
  if (!category) {
    category = await db.category.create({ data: { name: '蛋面', prefix: 'EXCEL' } });
    createdCategory = true;
  }
  categoryId = category.id;
  tagId = (await db.tag.create({ data: { name: `白幽灵-${suffix}` } })).id;
  styleId = (await db.settingStyle.create({ data: { magicBoxStyle: `银素边-${suffix}` } })).id;
});
afterAll(async () => {
  if (enabled) {
    await db.cabochonExcelImport.deleteMany({ where: { id: { in: jobs } } });
    await db.productStockAdjustment.deleteMany({ where: { productId: { in: products } } });
    await db.product.deleteMany({ where: { id: { in: products } } });
    await db.productCode.deleteMany({ where: { productId: { in: products } } });
    await db.tag.deleteMany({ where: { id: { in: [tagId, ...extraTagIds] } } });
    await db.settingStyle.deleteMany({
      where: { OR: [{ id: styleId }, { magicBoxStyle: { in: styleNames } }] },
    });
    await db.uploadGrant.deleteMany({ where: { objectKey: { in: grants } } });
    if (createdCategory) {
      await db.productCode.deleteMany({ where: { categoryId } });
      await db.category.delete({ where: { id: categoryId } });
    }
  }
  await db.$disconnect();
});
describe.skipIf(!enabled)('Excel historical inventory transactions', () => {
  it('saves multiple recognized tags and their base type through draft reload and product commit', async () => {
    const base = await db.tag.create({ data: { name: `云母-${suffix}` } });
    const compound = await db.tag.create({ data: { name: `粉云母-${suffix}` } });
    extraTagIds.push(base.id, compound.id);
    const type = `粉云母-${suffix}`;
    const { job } = await draft({ nickname: '浮光', type });
    const reviewed = await updateExcelRow(job.id, {
      version: job.version,
      row: { ...job.rows[0], tagMatch: { source: type, tagIds: [compound.id], missingTags: [] } },
    });
    const reloaded = await getExcelImport(reviewed.id);
    expect(reloaded.rows[0].tagMatch?.tagIds).toEqual([compound.id]);
    const result = await commit(reloaded);
    const product = await db.product.findUniqueOrThrow({
      where: { id: result.rows[0].receipt!.productId },
      include: { tags: true },
    });
    expect(product.name).toBe(`浮光-${type}`);
    expect(product.tags.map((tag) => tag.tagId).sort()).toEqual([base.id, compound.id].sort());
  });
  it('persists manual names and explicit existing styles through review, reload and import', async () => {
    const { job } = await draft({ nickname: '原艺名', style: 'Excel 款式原文' });
    const reviewed = await updateExcelRow(job.id, {
      version: job.version,
      row: {
        ...job.rows[0],
        productName: '手动商品名称',
        styleChoice: 'SELECT',
        styleId,
        sourceStyle: '伪造原文',
      },
    });
    const loaded = await getExcelImport(job.id);
    expect(loaded.rows[0]).toMatchObject({
      productName: '手动商品名称',
      sourceStyle: 'Excel 款式原文',
    });
    const imported = await commit(reviewed);
    expect(
      await db.product.findUniqueOrThrow({
        where: { id: imported.rows[0].receipt!.productId },
        include: { extraInfo: true },
      }),
    ).toMatchObject({ name: '手动商品名称', extraInfo: { settingStyleId: styleId } });
    expect(imported.rows[0].receipt!.settingStyle).toMatchObject({ id: styleId, created: false });
  });
  it('atomically applies a style to the same original text, preserves committed rows and records creation once', async () => {
    const raw = `待核对-${suffix}`;
    const newName = `批量新款-${suffix}`;
    styleNames.push(newName);
    const { input } = await draft({ style: raw });
    const batch = await createExcelImport({
      ...input,
      id: crypto.randomUUID(),
      rows: [
        input.rows[0],
        { ...input.rows[0], rowNumber: 3, productName: '另一商品名称' },
        { ...input.rows[0], rowNumber: 4, styleChoice: 'NONE' },
        { ...input.rows[0], rowNumber: 5, values: { ...input.rows[0].values, style: '其他写法' } },
      ],
    });
    jobs.push(batch.id);
    const partial = await commitExcelRow(batch.id, 4, batch.version);
    products.push(partial.rows[2].receipt!.productId);
    const edited = {
      ...partial.rows[0],
      styleChoice: 'NEW' as const,
      productName: '主商品名称',
      values: { ...partial.rows[0].values, style: newName },
    };
    const reviewed = await updateExcelRow(batch.id, {
      version: partial.version,
      row: edited,
      applySameStyle: true,
    });
    expect(reviewed.version).toBe(partial.version + 1);
    expect(reviewed.rows[1]).toMatchObject({
      productName: '另一商品名称',
      sourceStyle: raw,
      styleChoice: 'NEW',
      values: { style: newName },
    });
    expect(reviewed.rows[2]).toEqual(partial.rows[2]);
    expect(reviewed.rows[3]).toEqual(partial.rows[3]);
    expect(await db.settingStyle.findUnique({ where: { magicBoxStyle: newName } })).toBeNull();
    await expect(
      updateExcelRow(batch.id, { version: partial.version, row: edited, applySameStyle: true }),
    ).rejects.toThrow('EXCEL_CONFLICT');
    const first = await commit(reviewed);
    const second = await commitExcelRow(batch.id, 3, first.version);
    products.push(second.rows[1].receipt!.productId);
    const style = await db.settingStyle.findUniqueOrThrow({ where: { magicBoxStyle: newName } });
    expect(first.rows[0].receipt!.settingStyle).toEqual({
      id: style.id,
      name: newName,
      created: true,
    });
    expect(second.rows[1].receipt!.settingStyle).toEqual({
      id: style.id,
      name: newName,
      created: false,
    });
    expect((await getExcelImport(batch.id)).rows[0].receipt!.settingStyle?.created).toBe(true);
    expect(
      await db.product.findUniqueOrThrow({
        where: { id: second.rows[1].receipt!.productId },
        include: { extraInfo: true },
      }),
    ).toMatchObject({ name: '另一商品名称', extraInfo: { settingStyleId: style.id } });
  });
  it('does not create ignored styles or silently replace an unavailable selected style', async () => {
    const name = `忽略款式-${suffix}`;
    const { job } = await draft({ style: name });
    const unavailable = await updateExcelRow(job.id, {
      version: job.version,
      row: { ...job.rows[0], styleChoice: 'SELECT', styleId: 'clx99999999999999999999999' },
    });
    await expect(commitExcelRow(job.id, 2, unavailable.version)).rejects.toThrow(
      'EXCEL_ROW_INVALID',
    );
    expect(await db.settingStyle.findUnique({ where: { magicBoxStyle: name } })).toBeNull();
    const ignored = await updateExcelRow(job.id, {
      version: unavailable.version,
      row: { ...unavailable.rows[0], styleChoice: 'NONE' },
    });
    const imported = await commit(ignored);
    expect(imported.rows[0].receipt!.settingStyle).toBeNull();
    expect(await db.settingStyle.findUnique({ where: { magicBoxStyle: name } })).toBeNull();
  });
  it('saves drafts without products or reservations, and claims each image once', async () => {
    const before = await db.productCode.count({ where: { categoryId } });
    const { job, input } = await draft({}, true);
    expect(await db.productCode.count({ where: { categoryId } })).toBe(before);
    expect(job.rows[0].receipt).toBeNull();
    expect(await createExcelImport(input)).toMatchObject({ id: job.id });
    await expect(createExcelImport({ ...input, id: crypto.randomUUID() })).rejects.toThrow(
      'INVALID_IMAGE',
    );
    expect(job.rows[0].images[0].url).toBe(`/api/images/${input.rows[0].imageKeys[0]}`);
    expect(
      (await listExcelImports(input.fileHash, input.sheetName)).some((item) => item.id === job.id),
    ).toBe(true);
  });
  it('imports all fields, a private image and historical stock without inventing a supplier/source', async () => {
    const { job } = await draft(
      {
        nickname: '雪隐',
        type: `白幽灵-${suffix}`,
        style: `银素边-${suffix}`,
        roughStoneCost: '100',
        settingCost: '25',
        price: '300',
        correctedPrice: '250',
        measurement: '11x22x33\n12*23*34',
        notes: '状态良好',
        videoShot: '是',
        published: '是',
      },
      true,
    );
    const result = await commit(job);
    const receipt = result.rows[0].receipt!;
    const product = await db.product.findUniqueOrThrow({
      where: { id: receipt.productId },
      include: {
        tags: true,
        images: true,
        cost: true,
        measurement: true,
        marketing: true,
        extraInfo: true,
        stockAdjustments: true,
        purchaseEntries: true,
        diyRuns: true,
      },
    });
    expect(product).toMatchObject({
      name: `雪隐-白幽灵-${suffix}`,
      origin: null,
      stock: 1,
      priceCents: 25000,
      saleRule: 'CUSTOM_AMOUNT',
      saleManual: true,
      published: false,
      description: '状态良好',
      extraInfo: { settingStyleId: styleId },
      marketing: {
        videoShot: true,
        xiaohongshuVideoPublished: true,
        xiaohongshuListed: true,
        douyinVideoPublished: false,
      },
      purchaseEntries: [],
      diyRuns: [],
    });
    expect(product.tags[0].tagId).toBe(tagId);
    expect(product.images[0].objectKey).toBe(job.rows[0].imageKeys[0]);
    expect(product.cost!.totalCost.toFixed(2)).toBe('125.00');
    expect(product.measurement!.lengthMm!.toNumber()).toBe(12);
    expect(product.stockAdjustments[0]).toMatchObject({ delta: 1, beforeQty: 0, afterQty: 1 });
    expect(product.code).toMatch(/^EXCEL\d{4}$/);
    expect(product.code).not.toBe('OLD-01');
    expect(
      (await db.productCode.findUniqueOrThrow({ where: { code: product.code } })).productId,
    ).toBe(product.id);
  });
  it('imports blank rows as unknown/zero and sold rows with zero stock', async () => {
    const blank = await commit((await draft()).job);
    expect(
      await db.product.findUniqueOrThrow({
        where: { id: blank.rows[0].receipt!.productId },
        include: { extraInfo: true },
      }),
    ).toMatchObject({ name: '未知', priceCents: 0, stock: 1, extraInfo: { settingStyleId: null } });
    const sold = await commit((await draft({ sold: '是' })).job);
    expect(
      await db.product.findUniqueOrThrow({ where: { id: sold.rows[0].receipt!.productId } }),
    ).toMatchObject({ stock: 0 });
    const zeroPrice = await commit((await draft({ price: '500', correctedPrice: '0' })).job);
    expect(
      await db.product.findUniqueOrThrow({ where: { id: zeroPrice.rows[0].receipt!.productId } }),
    ).toMatchObject({ priceCents: 0 });
  });
  it('creates missing styles only on commit and reuses them across concurrent imports and retries', async () => {
    const magicBoxStyle = `新魔盒-${suffix}`;
    styleNames.push(magicBoxStyle);
    const first = (await draft({ style: ` ${magicBoxStyle} ` })).job;
    const second = (await draft({ style: magicBoxStyle })).job;
    expect(await db.settingStyle.findUnique({ where: { magicBoxStyle } })).toBeNull();
    const results = await Promise.all([commit(first), commit(second)]);
    expect(results.filter((result) => result.rows[0].receipt!.settingStyle?.created)).toHaveLength(
      1,
    );
    const style = await db.settingStyle.findUniqueOrThrow({ where: { magicBoxStyle } });
    for (const result of results) {
      expect(
        await db.cabochonExtraInfo.findUniqueOrThrow({
          where: { productId: result.rows[0].receipt!.productId },
        }),
      ).toMatchObject({ settingStyleId: style.id });
    }
    expect((await commitExcelRow(first.id, 2, first.version)).rows[0].receipt).toEqual(
      results[0].rows[0].receipt,
    );
    expect(await db.settingStyle.count({ where: { magicBoxStyle } })).toBe(1);
  });
  it('returns a stable receipt for simultaneous commits and lost-response retries', async () => {
    const { job } = await draft();
    const result = await Promise.all([
      commitExcelRow(job.id, 2, job.version),
      commitExcelRow(job.id, 2, job.version),
    ]);
    const productId = result[0].rows[0].receipt!.productId;
    products.push(productId);
    expect(result[1].rows[0].receipt!.productId).toBe(productId);
    expect((await commitExcelRow(job.id, 2, job.version)).rows[0].receipt!.productId).toBe(
      productId,
    );
    expect(await db.productStockAdjustment.count({ where: { productId } })).toBe(1);
    await expect(
      updateExcelRow(job.id, { version: result[0].version, row: job.rows[0] }),
    ).rejects.toThrow('EXCEL_ALREADY_COMMITTED');
  });
  it('blocks unresolved tags, supports review, and rejects stale edits', async () => {
    const { job } = await draft({ type: '没有这个标签' });
    const before = await db.productCode.count({ where: { categoryId } });
    await expect(commitExcelRow(job.id, 2, job.version)).rejects.toThrow('EXCEL_ROW_INVALID');
    expect(await db.productCode.count({ where: { categoryId } })).toBe(before);
    const reviewed = await updateExcelRow(job.id, {
      version: job.version,
      row: { ...job.rows[0], original: [], tagChoice: 'NONE' },
    });
    expect(reviewed.rows[0].original).toEqual(job.rows[0].original);
    await expect(
      updateExcelRow(job.id, { version: job.version, row: job.rows[0] }),
    ).rejects.toThrow('EXCEL_CONFLICT');
    await commit(reviewed);
  });
  it('rolls back new styles, code allocation, product and receipt when attachment validation fails', async () => {
    const magicBoxStyle = `回滚魔盒-${suffix}`;
    styleNames.push(magicBoxStyle);
    const { job } = await draft({ style: magicBoxStyle }, true);
    const broken = job.rows.map((row) => ({ ...row, images: [] }));
    await db.cabochonExcelImport.update({ where: { id: job.id }, data: { rows: broken } });
    const beforeCodes = await db.productCode.count({ where: { categoryId } });
    const beforeProducts = await db.product.count({ where: { categoryId } });
    await expect(commitExcelRow(job.id, 2, job.version)).rejects.toThrow('INVALID_IMAGE');
    expect(await db.settingStyle.findUnique({ where: { magicBoxStyle } })).toBeNull();
    expect(await db.productCode.count({ where: { categoryId } })).toBe(beforeCodes);
    expect(await db.product.count({ where: { categoryId } })).toBe(beforeProducts);
    expect(await getExcelImport(job.id)).toMatchObject({
      version: job.version,
      rows: [{ receipt: null }],
    });
  });
  it('keeps the ordinary source requirement and code-reservation behavior', async () => {
    const reserved = await reserveProductCode(categoryId);
    await expect(
      saveProduct({
        code: reserved.code,
        codeReservationToken: reserved.reservationToken,
        name: '普通新建仍需来源',
        description: '',
        categoryId,
        priceCents: 0,
        currency: 'CNY',
        stock: 1,
        published: false,
        imageKeys: [],
      }),
    ).rejects.toThrow('PRODUCT_SOURCE_REQUIRED');
  });
});
