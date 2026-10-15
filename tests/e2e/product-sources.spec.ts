import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD.');

test('purchased and DIY products share a batch and keep their costs and stock', async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const db = new PrismaClient();
  const suffix = Date.now().toString(36);
  const productIds: string[] = [];
  const category = await db.category.create({ data: { name: `商品${suffix}` } });
  const eggCategory = await db.category.create({ data: { name: '蛋面' } });
  const materialCategory = await db.materialCategory.create({ data: { name: `物料${suffix}` } });
  const distributor = await db.distributor.create({
    data: { name: `渠道${suffix}`, area: '网络' },
  });
  const batch = await db.materialBatch.create({
    data: { name: `采购${suffix}`, receivedAt: new Date('2026-10-13T00:00:00.000Z') },
  });
  const material = await db.material.create({
    data: { name: `珠串${suffix}`, categoryId: materialCategory.id },
  });
  const entry = await db.materialBatchEntry.create({
    data: {
      materialId: material.id,
      batchId: batch.id,
      distributorId: distributor.id,
      receivedQty: 2,
      remainingQty: 2,
      purchaseUnitPrice: '100.00',
      childUnitPrice: '5.00',
      purchaseGramPrice: '10.00',
    },
  });
  try {
    await page.goto('/zh/login');
    await page.getByLabel('账号').fill(username!);
    await page.getByLabel('密码').fill(password!);
    await page.getByRole('button', { name: /登\s*录/ }).click();
    await expect(page).toHaveURL(/\/zh\/admin\/products/);

    await page.goto('/zh/admin/products/new');
    await page.getByLabel('商品名称').fill('进货成品测试');
    await page.getByLabel('售价（元）').fill('50');
    await page.getByLabel('所属分类').click();
    await page.locator('.ant-select-dropdown:visible').getByText(category.name).click();
    await page.locator('.editor-field-code input').fill(`BUY-${suffix}`);
    const source = page.locator('.product-source-fields').first();
    await source
      .locator('.source-field')
      .filter({ hasText: '进货批次' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText(batch.name).click();
    await source
      .locator('.source-field')
      .filter({ hasText: '来源渠道商' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText(distributor.name).click();
    await source
      .locator('.source-field')
      .filter({ hasText: /^数量$/ })
      .locator('input')
      .fill('2');
    await source
      .locator('.source-field')
      .filter({ hasText: '单件成本' })
      .locator('input')
      .fill('12');
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page).toHaveURL(/\/zh\/admin\/products$/);
    const purchased = (await (await page.request.get(`/api/products?q=BUY-${suffix}`)).json())
      .items[0];
    productIds.push(purchased.id);
    expect(purchased).toMatchObject({ stock: 2, origin: 'PURCHASED' });
    expect(purchased.purchaseEntries[0]).toMatchObject({ batchId: batch.id, unitCost: '12.00' });

    await page.goto(`/zh/admin/products/${purchased.id}`);
    await page.getByRole('button', { name: '新增来源记录' }).click();
    const drawer = page.getByRole('dialog', { name: '新增来源记录' });
    await drawer
      .locator('.source-field')
      .filter({ hasText: '进货批次' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText(batch.name).click();
    await drawer
      .locator('.source-field')
      .filter({ hasText: '来源渠道商' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText(distributor.name).click();
    await drawer
      .locator('.source-field')
      .filter({ hasText: /^数量$/ })
      .locator('input')
      .fill('1');
    await drawer
      .locator('.source-field')
      .filter({ hasText: '单件成本' })
      .locator('input')
      .fill('13');
    await drawer.getByRole('button', { name: '保存记录' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByText('当前库存：3')).toBeVisible();
    await page.getByRole('button', { name: '库存盘点' }).click();
    const adjust = page.getByRole('dialog', { name: '库存盘点' });
    await adjust
      .locator('.source-field')
      .filter({ hasText: '调整数量' })
      .locator('input')
      .fill('-1');
    await adjust
      .locator('.source-field')
      .filter({ hasText: '调整原因' })
      .locator('textarea')
      .fill('盘点');
    await adjust.getByRole('button', { name: '保存记录' }).click();
    await expect(adjust).toBeHidden();
    await expect(page.locator('.product-source-actions > span')).toHaveText('当前库存：2');

    const eggResponse = await page.request.post('/api/products', {
      data: {
        code: `EGG-${suffix}`,
        name: '蛋面投入测试',
        description: '',
        categoryId: eggCategory.id,
        priceCents: 3000,
        currency: 'CNY',
        stock: 0,
        published: false,
        imageKeys: [],
        cost: {
          roughStoneCost: '20.00',
          settingCost: null,
          otherCosts: [],
          totalCost: '20.00',
          totalManual: false,
        },
        source: {
          origin: 'PURCHASED',
          selection: { batchId: batch.id },
          distributorId: distributor.id,
          quantity: 1,
          unitCost: '20.00',
          notes: '',
        },
      },
    });
    expect(eggResponse.status()).toBe(201);
    const egg = await eggResponse.json();
    productIds.push(egg.id);

    await page.goto('/zh/admin/products/new');
    await page.getByLabel('商品名称').fill('DIY 成品测试');
    await page.getByLabel('售价（元）').fill('80');
    await page.getByLabel('所属分类').click();
    await page.locator('.ant-select-dropdown:visible').getByText(category.name).click();
    await page.locator('.editor-field-code input').fill(`DIY-${suffix}`);
    const diyFields = page.locator('.product-source-fields').first();
    await diyFields
      .locator('.source-field')
      .filter({ hasText: '来源类型' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText('DIY 制作').click();
    await diyFields
      .locator('.source-field')
      .filter({ hasText: /^数量$/ })
      .locator('input')
      .fill('2');
    await page.getByRole('button', { name: '添加物料' }).click();
    const materialLine = diyFields.locator('.product-source-line').first();
    await materialLine
      .locator('.source-field')
      .filter({ hasText: '物料与批次' })
      .locator('.ant-select')
      .click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText(`${material.name} · ${batch.name}`)
      .click();
    await expect(
      materialLine.locator('.source-field').filter({ hasText: '投入单价' }).locator('input'),
    ).toHaveValue('5.00');
    await materialLine
      .locator('.source-field')
      .filter({ hasText: '用量单位' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText('克', { exact: true }).click();
    await expect(
      materialLine.locator('.source-field').filter({ hasText: '投入单价' }).locator('input'),
    ).toHaveValue('10.00');
    await materialLine
      .locator('.source-field')
      .filter({ hasText: '每件用量' })
      .locator('input')
      .fill('0.5');
    await page.getByRole('button', { name: '添加蛋面' }).click();
    const eggLine = diyFields.locator('.product-source-line').nth(1);
    await eggLine
      .locator('.source-field')
      .filter({ hasText: '蛋面商品' })
      .locator('.ant-select')
      .click();
    await page
      .locator('.ant-select-dropdown:visible')
      .getByText(`${egg.name} · ${egg.code}`)
      .click();
    await expect(
      eggLine.locator('.source-field').filter({ hasText: '投入单价' }).locator('input'),
    ).toHaveValue('20.00');
    await page.getByRole('button', { name: '添加费用' }).click();
    const extraLine = diyFields.locator('.product-source-line').nth(2);
    await extraLine
      .locator('.source-field')
      .filter({ hasText: '费用名称' })
      .locator('input')
      .fill('配件');
    await extraLine.locator('.source-field').filter({ hasText: '金额' }).locator('input').fill('2');
    await expect(diyFields.getByText('单件总成本: ¥27.00')).toBeVisible();
    await page.screenshot({
      path: '/tmp/crystal-product-source-editor-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: '/tmp/crystal-product-source-editor-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page).toHaveURL(/\/zh\/admin\/products$/);
    const diy = (await (await page.request.get(`/api/products?q=DIY-${suffix}`)).json()).items[0];
    productIds.push(diy.id);
    expect(diy).toMatchObject({ origin: 'DIY', stock: 2 });
    expect(diy.diyRuns[0].perUnitCost).toBe('27.00');
    expect(
      (await (await page.request.get(`/api/materials/${material.id}`)).json()).batchEntries[0]
        .remainingQty,
    ).toBe(2);
    expect((await (await page.request.get(`/api/products/${egg.id}`)).json()).stock).toBe(1);

    await page.goto(`/zh/admin/materials/batches/${batch.id}`);
    await expect(page.getByRole('link', { name: '进货成品测试 · ' + purchased.code })).toHaveCount(
      2,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/tmp/crystal-product-sources-mobile.png', fullPage: true });
  } finally {
    await db.productDiyRun.deleteMany({ where: { productId: { in: productIds } } });
    await db.productPurchaseEntry.deleteMany({ where: { productId: { in: productIds } } });
    await db.productStockAdjustment.deleteMany({ where: { productId: { in: productIds } } });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
    await db.materialBatchEntry.delete({ where: { id: entry.id } });
    await db.material.delete({ where: { id: material.id } });
    await db.materialBatch.delete({ where: { id: batch.id } });
    await db.distributor.delete({ where: { id: distributor.id } });
    await db.materialCategory.delete({ where: { id: materialCategory.id } });
    await db.category.delete({ where: { id: category.id } });
    await db.category.delete({ where: { id: eggCategory.id } });
    await db.$disconnect();
  }
});
