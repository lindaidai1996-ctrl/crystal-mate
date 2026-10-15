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
  expect((await request.get('/api/tags')).status()).toBe(401);

  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);
  expect((await page.request.get('/api/categories')).status()).toBe(200);

  await page.getByRole('menuitem', { name: '产品分类' }).click();
  await page.getByRole('button', { name: '新建产品分类' }).click();
  const categoryName = `测试分类${Date.now()}`;
  await page.getByLabel('分类名称').fill(categoryName);
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText(categoryName)).toBeVisible();

  await page.getByRole('menuitem', { name: '标签' }).click();
  await page.getByRole('button', { name: '新建标签' }).click();
  const tagName = `测试标签${Date.now()}`;
  await page
    .getByRole('dialog', { name: '新建标签' })
    .getByLabel('标签名称')
    .fill(`  ${tagName}  `);
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText(tagName)).toBeVisible();
  const tag = (await (await page.request.get('/api/tags')).json()).find(
    (item: { name: string }) => item.name === tagName,
  );
  expect((await page.request.post('/api/tags', { data: { name: ` ${tagName} ` } })).status()).toBe(
    409,
  );
  const secondTagName = `配饰${Date.now()}`;
  const secondTagResponse = await page.request.post('/api/tags', {
    data: { name: secondTagName },
  });
  expect(secondTagResponse.status()).toBe(201);
  const secondTag = await secondTagResponse.json();
  const caseName = `Case${Date.now()}`;
  const upperTagResponse = await page.request.post('/api/tags', { data: { name: caseName } });
  const lowerTagResponse = await page.request.post('/api/tags', {
    data: { name: caseName.toLowerCase() },
  });
  expect(upperTagResponse.status()).toBe(201);
  expect(lowerTagResponse.status()).toBe(201);
  expect(
    (await page.request.delete(`/api/tags/${(await upperTagResponse.json()).id}`)).status(),
  ).toBe(204);
  expect(
    (await page.request.delete(`/api/tags/${(await lowerTagResponse.json()).id}`)).status(),
  ).toBe(204);

  await page.locator('[role="menuitem"][data-menu-id$="-products"]').click();
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
  await page.getByRole('button', { name: '新建商品' }).click();
  const code = `TEST-${Date.now()}`;
  await page.getByLabel('商品名称').fill('测试紫水晶');
  await page.getByLabel('所属分类').click();
  await page.locator('.ant-select-dropdown:visible').getByText(categoryName).click();
  await expect(page.getByLabel('内部编码')).toHaveValue(/^C\d{4}$/);
  await page.getByLabel('内部编码').fill(code);
  await page.getByLabel('商品标签').click();
  await page.locator('.ant-select-dropdown:visible').getByText(tagName).click();
  await page.locator('.ant-select-dropdown:visible').getByText(secondTagName).click();
  await page.getByLabel('售价（元）').fill('129.50');
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
    .filter({ hasText: /^数量$/ })
    .locator('input')
    .fill('1');
  await sourceFields
    .locator('.source-field')
    .filter({ hasText: '单件成本' })
    .locator('input')
    .fill('60');
  await expect(page.getByRole('switch', { name: '已拍摄商品视频' })).toBeChecked();
  await expect(page.getByRole('switch', { name: '小红书已发布商品视频' })).toBeChecked();
  await expect(page.getByRole('switch', { name: '小红书已上架' })).toBeChecked();
  await expect(page.getByRole('switch', { name: '抖音已发布商品视频' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: '抖音已上架' })).not.toBeChecked();
  await expect(page.getByText('蛋面尺寸')).toHaveCount(0);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YkEL2sAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'front.png', mimeType: 'image/png', buffer: png },
    { name: 'back.png', mimeType: 'image/png', buffer: png },
  ]);
  const imageChoice = page.getByRole('dialog', { name: '是否压缩图片？' });
  await expect(imageChoice).toBeVisible();
  await expect(page.locator('.image-picker-sortable')).toHaveCount(0);
  await imageChoice.getByText('上传原图', { exact: true }).click();
  await imageChoice.getByRole('button', { name: '上传所选版本' }).click();
  await expect(page.locator('.image-picker-sortable')).toHaveCount(2);
  const imageUrls = await page
    .locator('.image-picker-sortable .ant-upload-list-item-thumbnail img')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')));
  await page.locator('.image-picker-sortable').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText(code)).toBeVisible();

  const productResponse = await page.request.get(`/api/products?q=${code}`);
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()).items[0];
  expect(product.marketing).toMatchObject({
    videoShot: true,
    xiaohongshuVideoPublished: true,
    xiaohongshuListed: true,
    douyinVideoPublished: false,
    douyinListed: false,
  });
  expect(product.measurement).toBeNull();
  expect(
    (
      await page.request.put(`/api/products/${product.id}`, {
        data: {
          ...product,
          imageKeys: product.images.map((image: { objectKey: string }) => image.objectKey),
          measurement: { lengthMm: 11 },
        },
      })
    ).status(),
  ).toBe(400);
  expect(product.tags.map((item: { name: string }) => item.name)).toEqual(
    expect.arrayContaining([tagName, secondTagName]),
  );
  const legacyUpdate = await page.request.put(`/api/products/${product.id}`, {
    data: {
      ...product,
      marketing: undefined,
      imageKeys: product.images.map((image: { objectKey: string }) => image.objectKey),
    },
  });
  expect(legacyUpdate.status()).toBe(200);
  expect((await legacyUpdate.json()).tags).toHaveLength(2);
  expect(
    (await (await page.request.get(`/api/products/${product.id}`)).json()).marketing,
  ).toMatchObject(product.marketing);
  expect(product.images.map((image: { url: string }) => image.url)).toEqual([
    imageUrls[1],
    imageUrls[0],
  ]);
  const categoryResponse = await page.request.get('/api/categories');
  const category = (await categoryResponse.json()).find(
    (item: { name: string }) => item.name === categoryName,
  );
  expect((await page.request.delete(`/api/categories/${category.id}`)).status()).toBe(409);
  expect((await page.request.delete(`/api/tags/${tag.id}`)).status()).toBe(409);
  expect(
    (
      await page.request.post('/api/products', {
        data: {
          ...product,
          imageKeys: [],
          images: undefined,
          source: {
            origin: 'PURCHASED',
            selection: { batchId: batch.id },
            distributorId: distributor.id,
            quantity: 1,
            unitCost: '60.00',
            notes: '',
          },
        },
      })
    ).status(),
  ).toBe(409);
  const multiStockUpdate = await page.request.post(
    `/api/products/${product.id}/stock-adjustments`,
    {
      data: { delta: 1, reason: '补录库存' },
    },
  );
  expect(multiStockUpdate.status()).toBe(201);
  expect((await multiStockUpdate.json()).stock).toBe(2);
  expect((await (await page.request.get(`/api/products?q=${code}&stock=1`)).json()).total).toBe(1);
  expect(
    (
      await page.request.put(`/api/products/${product.id}`, {
        data: {
          ...product,
          imageKeys: product.images.map((image: { objectKey: string }) => image.objectKey),
          tagIds: [tag.id, tag.id],
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.put(`/api/products/${product.id}`, {
        data: {
          ...product,
          imageKeys: product.images.map((image: { objectKey: string }) => image.objectKey),
          tagIds: ['clx1234567890123456789012'],
        },
      })
    ).status(),
  ).toBe(400);

  await page.getByPlaceholder('搜索名称或编码').fill(code);
  await expect(page.locator('.ant-table-row')).toHaveCount(1);
  await page.locator('.filter-bar .ant-select').nth(1).click();
  await page.locator('.ant-select-dropdown:visible').getByText(tagName).click();
  await expect(page.locator('.ant-table-row')).toHaveCount(1);
  expect((await (await page.request.get(`/api/products?tagId=${tag.id}`)).json()).total).toBe(1);
  await page.locator('.filter-bar .ant-select').nth(1).locator('.ant-select-clear').click();
  await page.getByRole('link', { name: '测试紫水晶' }).click();
  await page.getByRole('button', { name: '库存盘点' }).click();
  const stockDrawer = page.getByRole('dialog', { name: '库存盘点' });
  await stockDrawer
    .locator('.source-field')
    .filter({ hasText: '调整数量' })
    .locator('input')
    .fill('-2');
  await stockDrawer
    .locator('.source-field')
    .filter({ hasText: '调整原因' })
    .locator('textarea')
    .fill('售出');
  await stockDrawer.getByRole('button', { name: '保存记录' }).click();
  await expect(stockDrawer).toBeHidden();
  await page.getByRole('link', { name: '返回商品列表' }).click();
  await expect(page.getByRole('row').filter({ hasText: code }).getByText('已售罄')).toBeVisible();
  expect((await (await page.request.get(`/api/products?q=${code}&stock=0`)).json()).total).toBe(1);
  const afterStockEdit = await (await page.request.get(`/api/products/${product.id}`)).json();
  expect(afterStockEdit.tags).toHaveLength(2);
  const cleared = await page.request.put(`/api/products/${product.id}`, {
    data: {
      ...afterStockEdit,
      imageKeys: afterStockEdit.images.map((image: { objectKey: string }) => image.objectKey),
      tagIds: [],
    },
  });
  expect(cleared.status()).toBe(200);
  expect((await cleared.json()).tags).toEqual([]);
  expect((await page.request.delete(`/api/tags/${tag.id}`)).status()).toBe(204);
  const renamed = await page.request.put(`/api/tags/${secondTag.id}`, {
    data: { name: `${secondTagName}新` },
  });
  expect(renamed.status()).toBe(200);

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
  await page.getByRole('menuitem', { name: /Tags/ }).click();
  const tagRow = page.getByRole('row').filter({ hasText: `${secondTagName}新` });
  await tagRow.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(tagRow).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
  await expect(page.locator('.table-surface')).toBeVisible();
  expect((await page.request.delete(`/api/material-batches/${batch.id}`)).status()).toBe(204);
  expect((await page.request.delete(`/api/distributors/${distributor.id}`)).status()).toBe(204);
});
