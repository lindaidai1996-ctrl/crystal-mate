import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(
  !username || !password,
  'Set E2E_USERNAME and E2E_PASSWORD for an initialized local admin.',
);

test('admin catalog workflow and language switch', async ({ page, request }) => {
  test.setTimeout(90_000);
  const unauthorized = await request.get('/api/products');
  expect(unauthorized.status()).toBe(401);

  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);
  expect((await page.request.get('/api/categories')).status()).toBe(200);

  await page.getByRole('menuitem', { name: '分类' }).click();
  await page.getByRole('button', { name: '新建分类' }).click();
  const categoryName = `测试分类${Date.now()}`;
  await page.getByLabel('分类名称').fill(categoryName);
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText(categoryName)).toBeVisible();

  await page.getByRole('menuitem', { name: '商品' }).click();
  await page.getByRole('button', { name: '新建商品' }).click();
  const code = `TEST-${Date.now()}`;
  await page.getByLabel('商品名称').fill('测试紫水晶');
  await page.getByLabel('内部编码').fill(code);
  await page.getByLabel('所属分类').click();
  await page.locator('.ant-select-dropdown:visible').getByText(categoryName).click();
  await page.getByLabel('售价（元）').fill('129.50');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YkEL2sAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'front.png', mimeType: 'image/png', buffer: png },
    { name: 'back.png', mimeType: 'image/png', buffer: png },
  ]);
  await expect(page.locator('.image-item')).toHaveCount(2);
  const imageUrls = await page
    .locator('.image-item img')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')));
  await page.getByRole('button', { name: '后移' }).first().click();
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText(code)).toBeVisible();

  const productResponse = await page.request.get(`/api/products?q=${code}`);
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()).items[0];
  expect(product.images.map((image: { url: string }) => image.url)).toEqual([
    imageUrls[1],
    imageUrls[0],
  ]);
  const categoryResponse = await page.request.get('/api/categories');
  const category = (await categoryResponse.json()).find(
    (item: { name: string }) => item.name === categoryName,
  );
  expect((await page.request.delete(`/api/categories/${category.id}`)).status()).toBe(409);
  expect(
    (
      await page.request.post('/api/products', {
        data: { ...product, imageKeys: [], images: undefined },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.put(`/api/products/${product.id}`, {
        data: {
          ...product,
          imageKeys: product.images.map((image: { objectKey: string }) => image.objectKey),
          stock: 2,
        },
      })
    ).status(),
  ).toBe(400);

  await page.getByPlaceholder('搜索名称或编码').fill(code);
  await expect(page.locator('.ant-table-row')).toHaveCount(1);
  await page.getByRole('link', { name: '测试紫水晶' }).click();
  await page
    .locator('.ant-form-item')
    .filter({ hasText: '孤品库存只能为 0 或 1' })
    .locator('.ant-select-selector')
    .click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: '0' })
    .click({ timeout: 5000 });
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByRole('row').filter({ hasText: code }).getByText('已售罄')).toBeVisible();

  await page.locator('.language-select .ant-select-selector').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'English' })
    .click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: code }).getByText('测试紫水晶'),
  ).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: code });
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(row).toHaveCount(0);
  await page.getByRole('menuitem', { name: /Categories/ }).click();
  const categoryRow = page.getByRole('row').filter({ hasText: categoryName });
  await categoryRow.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(categoryRow).toHaveCount(0);
});
