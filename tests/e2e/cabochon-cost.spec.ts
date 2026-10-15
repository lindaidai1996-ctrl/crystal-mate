import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD for an initialized admin.');

test('cabochon costs calculate, persist, and follow category boundaries', async ({ page }) => {
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);

  const categories = await (await page.request.get('/api/categories')).json();
  const existingCabochon = categories.find((item: { name: string }) => item.name === '蛋面');
  const cabochon =
    existingCabochon ??
    (await (await page.request.post('/api/categories', { data: { name: '蛋面' } })).json());
  const other = await (
    await page.request.post('/api/categories', { data: { name: `其他${Date.now()}` } })
  ).json();
  const distributor = await (
    await page.request.post('/api/distributors', {
      data: {
        name: `测试渠道${Date.now()}`,
        area: '网络',
        address: '',
        wechat: '',
        phone: '',
        notes: '',
      },
    })
  ).json();
  const batch = await (
    await page.request.post('/api/material-batches', {
      data: { name: `测试采购${Date.now()}`, receivedAt: '2026-10-13', notes: '' },
    })
  ).json();
  let productId: string | undefined;

  try {
    await page.goto('/zh/admin/catalog/cabochons/new');
    await page.getByLabel('商品名称').fill('成本测试蛋面');
    await page.getByLabel('售价（元）').fill('10');
    const sourceFields = page.locator('.product-source-fields').first();
    await sourceFields
      .locator('.source-field')
      .filter({ hasText: '进货批次' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText(batch.name).click();
    await sourceFields
      .locator('.source-field')
      .filter({ hasText: '来源渠道商' })
      .locator('.ant-select')
      .click();
    await page.locator('.ant-select-dropdown:visible').getByText(distributor.name).click();
    await sourceFields
      .locator('.source-field')
      .filter({ hasText: '单件成本' })
      .locator('input')
      .fill('1');
    await page.getByLabel('裸石成本（元）').fill('0.10');
    await page.getByLabel('镶嵌成本（元）').fill('0.20');
    await page.getByRole('button', { name: '添加其他成本' }).click();
    await page.getByLabel('成本名称 1').fill('包装');
    await page.getByLabel('金额（元） 1').fill('0.03');
    await expect(page.getByLabel('总成本（元）')).toHaveValue('0.33');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByLabel('总成本（元）').fill('1.00');
    await page.getByLabel('裸石成本（元）').fill('0.40');
    await expect(page.getByLabel('总成本（元）')).toHaveValue('1.00');
    await page.getByRole('button', { name: '按明细重新计算' }).click();
    await expect(page.getByLabel('总成本（元）')).toHaveValue('0.63');
    await page.getByLabel('总成本（元）').fill('0.50');

    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/products') && response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: /保存/ }).click(),
    ]);
    expect(created.status()).toBe(201);
    const product = await created.json();
    productId = product.id;
    expect(product.cost).toEqual({
      roughStoneCost: '0.40',
      settingCost: '0.20',
      otherCosts: [{ name: '包装', amount: '0.03' }],
      totalCost: '0.50',
      totalManual: true,
    });
    expect((await (await page.request.get(`/api/products/${productId}`)).json()).cost).toEqual(
      product.cost,
    );

    const rename = await page.request.put(`/api/categories/${cabochon.id}`, {
      data: { name: `已改名蛋面${Date.now()}` },
    });
    expect(rename.status()).toBe(409);
    expect((await rename.json()).error).toBe('CABOCHON_COSTS_IN_USE');

    await page.goto(`/zh/admin/catalog/cabochons/${productId}`);
    await expect(page.getByLabel('总成本（元）')).toHaveValue('0.50');
    await page.getByLabel('总成本（元）').fill('');
    await expect(page.getByLabel('总成本（元）')).toHaveValue('0.63');
    await page.getByLabel('裸石成本（元）').fill('');
    await page.getByLabel('镶嵌成本（元）').fill('');
    await page.getByRole('button', { name: '移除其他成本 1' }).click();
    await expect(page.getByLabel('总成本（元）')).toHaveValue('');
    const clearedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/products/${productId}`) &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: /保存/ }).click();
    expect((await (await clearedResponse).json()).cost).toBeNull();

    const cost = {
      roughStoneCost: '1.00',
      settingCost: null,
      otherCosts: [],
      totalCost: '1.00',
      totalManual: false,
    };
    const restored = await page.request.put(`/api/products/${productId}`, {
      data: {
        ...product,
        categoryId: cabochon.id,
        imageKeys: [],
        tagIds: [],
        cost,
      },
    });
    expect(restored.status()).toBe(200);
    expect((await restored.json()).cost.totalCost).toBe('1.00');

    const invalid = await page.request.put(`/api/products/${productId}`, {
      data: { ...product, categoryId: other.id, imageKeys: [], tagIds: [], cost },
    });
    expect(invalid.status()).toBe(400);
    const moved = await page.request.put(`/api/products/${productId}`, {
      data: { ...product, categoryId: other.id, imageKeys: [], tagIds: [], cost: null },
    });
    expect(moved.status()).toBe(200);
    expect((await moved.json()).cost).toBeNull();
  } finally {
    if (productId) await page.request.delete(`/api/products/${productId}`);
    await page.request.delete(`/api/material-batches/${batch.id}`);
    await page.request.delete(`/api/distributors/${distributor.id}`);
    await page.request.delete(`/api/categories/${other.id}`);
    if (!existingCabochon) await page.request.delete(`/api/categories/${cabochon.id}`);
  }
});
