import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD for an initialized admin.');

test('catalog menus filter products and preserve allowed categories on save', async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const categories = [
    { id: 'category-cabochons', name: '蛋面' },
    { id: 'category-strands', name: '成品串' },
    { id: 'category-other', name: '其他饰品' },
  ];
  const products = categories.map((category, index) => ({
    id: `product-${index}`,
    code: `SCOPE-${index}`,
    name: `${category.name}测试商品`,
    description: '',
    categoryId: category.id,
    category,
    tags: [],
    priceCents: 100,
    currency: 'CNY',
    stock: 1,
    origin: 'PURCHASED' as const,
    purchaseEntries: [],
    diyRuns: [],
    stockAdjustments: [],
    cost: null,
    published: false,
    marketing: {
      videoShot: false,
      xiaohongshuVideoPublished: false,
      xiaohongshuListed: false,
      douyinVideoPublished: false,
      douyinListed: false,
    },
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  const createdTags: Array<{ id: string; name: string }> = [];
  const listQueries: URLSearchParams[] = [];
  const writes: Array<{ method: string; categoryId: string }> = [];
  const productPayloads: Array<Record<string, unknown>> = [];
  const marketingWrites: Array<{ field: string; value: boolean }> = [];
  let availableCategories = categories;
  let categoriesFail = false;
  let rejectNextSave = false;
  let rejectNextMarketingWrite = false;

  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);

  await page.route('**/api/categories', (route) =>
    route.fulfill(
      categoriesFail
        ? { status: 503, json: { error: 'SERVER_ERROR' } }
        : { json: availableCategories },
    ),
  );
  await page.route('**/api/tags', (route) => {
    if (route.request().method() === 'POST') {
      const name = String(route.request().postDataJSON().name).trim();
      if (createdTags.some((tag) => tag.name === name)) {
        return route.fulfill({ status: 409, json: { error: 'DUPLICATE' } });
      }
      const tag = { id: `tag-${createdTags.length + 1}`, name };
      createdTags.push(tag);
      return route.fulfill({ status: 201, json: tag });
    }
    return route.fulfill({ json: createdTags });
  });
  const batch = {
    id: 'clx1234567890123456789012',
    name: '测试批次',
    receivedAt: '2026-10-13',
    notes: '',
  };
  const distributor = { id: 'clx1234567890123456789013', name: '测试渠道' };
  await page.route('**/api/material-batches', (route) => route.fulfill({ json: [batch] }));
  await page.route('**/api/distributors', (route) =>
    route.fulfill({ json: { items: [distributor], areas: [], areaItems: [] } }),
  );
  await page.route(/\/api\/materials(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 50 } }),
  );
  await page.route(/\/api\/products(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      productPayloads.push(payload);
      writes.push({ method: 'POST', categoryId: payload.categoryId });
      if (rejectNextSave) {
        rejectNextSave = false;
        availableCategories = categories.filter((item) => item.name !== '蛋面');
        return route.fulfill({ status: 400, json: { error: 'CATEGORY_NOT_FOUND' } });
      }
      return route.fulfill({ status: 201, json: route.request().postDataJSON() });
    }
    const query = new URL(route.request().url()).searchParams;
    listQueries.push(query);
    const items = products.filter(
      (product) =>
        (!query.get('categoryId') || product.categoryId === query.get('categoryId')) &&
        (!query.get('excludeCategoryName') ||
          product.category.name !== query.get('excludeCategoryName')),
    );
    return route.fulfill({
      json: { items, total: items.length, page: 1, pageSize: 10 },
    });
  });
  await page.route(/\/api\/products\/[^/?]+$/, (route) => {
    const id = route.request().url().split('/').pop();
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON();
      productPayloads.push(payload);
      writes.push({ method: 'PUT', categoryId: payload.categoryId });
      return route.fulfill({ json: route.request().postDataJSON() });
    }
    return route.fulfill({ json: products.find((product) => product.id === id) });
  });
  await page.route(/\/api\/products\/[^/?]+\/marketing$/, (route) => {
    const { field, value } = route.request().postDataJSON();
    marketingWrites.push({ field, value });
    if (rejectNextMarketingWrite) {
      rejectNextMarketingWrite = false;
      return route.fulfill({ status: 503, json: { error: 'SERVER_ERROR' } });
    }
    const id = route.request().url().split('/').at(-2);
    const product = products.find((item) => item.id === id)!;
    product.marketing[field as keyof typeof product.marketing] = value;
    product.updatedAt = new Date().toISOString();
    return route.fulfill({ json: { value, updatedAt: product.updatedAt } });
  });
  await page.route('**/api/products/code', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return route.fulfill({
      json: {
        code: route.request().postDataJSON().categoryId === categories[0].id ? 'A0002' : 'B0002',
      },
    });
  });

  for (const [slug, category, menu] of [
    ['cabochons', categories[0], '蛋面管理'],
    ['finished-strands', categories[1], '成品管理'],
  ] as const) {
    await page.getByRole('menuitem', { name: menu }).click();
    await expect(page.getByRole('heading', { name: menu })).toBeVisible();
    await expect(page.getByRole('link', { name: `${category.name}测试商品` })).toBeVisible();
    expect(listQueries.at(-1)?.get('categoryId')).toBe(slug === 'cabochons' ? category.id : null);
    expect(listQueries.at(-1)?.get('excludeCategoryName')).toBe(
      slug === 'finished-strands' ? '蛋面' : null,
    );
    if (slug === 'finished-strands') {
      await expect(page.getByRole('link', { name: '其他饰品测试商品' })).toBeVisible();
      await expect(page.getByRole('link', { name: '蛋面测试商品' })).toHaveCount(0);
    }
    if (slug === 'cabochons') {
      await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0);
      for (const [field, label] of [
        ['videoShot', '已拍摄商品视频'],
        ['xiaohongshuVideoPublished', '小红书已发布商品视频'],
        ['xiaohongshuListed', '小红书已上架'],
      ]) {
        const control = page.getByRole('switch', { name: `${category.name}测试商品：${label}` });
        await expect(control).toHaveAttribute('aria-checked', 'false');
        await control.click();
        await expect(control).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByText('保存成功').first()).toBeVisible();
        expect(marketingWrites.at(-1)).toEqual({ field, value: true });
      }
      rejectNextMarketingWrite = true;
      const videoSwitch = page.getByRole('switch', { name: '蛋面测试商品：已拍摄商品视频' });
      await videoSwitch.click();
      await expect(videoSwitch).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByText('服务器暂时不可用，请稍后重试')).toBeVisible();
    }
    await page.getByPlaceholder('搜索名称或编码').fill(`SCOPE-${slug}`);
    await expect.poll(() => listQueries.at(-1)?.get('q')).toBe(`SCOPE-${slug}`);
    expect(listQueries.at(-1)?.get('categoryId')).toBe(slug === 'cabochons' ? category.id : null);

    await page.getByRole('button', { name: '新建商品' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/${slug}/new$`));
    await expect(
      page
        .locator('.ant-form-item')
        .filter({ hasText: '所属分类' })
        .locator('.ant-select-disabled'),
    ).toHaveCount(slug === 'cabochons' ? 1 : 0);
    if (slug === 'finished-strands') {
      await page.getByLabel('所属分类').click();
      await expect(page.locator('.ant-select-dropdown:visible').getByText('蛋面')).toHaveCount(0);
      await page.locator('.ant-select-dropdown:visible').getByText('成品串').click();
    }
    await expect(page.getByText('正在根据分类生成内部编码')).toBeVisible();
    await expect(page.getByRole('button', { name: /保\s*存/ })).toBeDisabled();
    await page.getByLabel('商品名称').fill(`${category.name}新商品`);
    await expect(page.locator('.editor-field-code input')).toHaveValue(
      slug === 'cabochons' ? 'A0002' : 'B0002',
    );
    await page.locator('.editor-field-code input').fill(`NEW-${slug}`);
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page.locator('.editor-field-price').getByText('请填写此项')).toBeVisible();
    await page.getByLabel('售价（元）').fill('12.50');
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page.getByText('请检查来源、数量、用料和成本')).toBeVisible();
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
      .fill('2');
    await sourceFields
      .locator('.source-field')
      .filter({ hasText: '单件成本' })
      .locator('input')
      .fill('5');
    if (slug === 'cabochons') {
      await page.getByRole('button', { name: '新建标签' }).click();
      const tagDialog = page.getByRole('dialog', { name: '新建标签' });
      await tagDialog.getByRole('textbox').fill('  临时标签  ');
      await tagDialog.getByRole('button', { name: /保\s*存/ }).click();
      await expect(tagDialog).toBeHidden();
      await expect(page.locator('.editor-field-tags .ant-select-selection-item')).toHaveText(
        '临时标签',
      );
      await expect(page.getByLabel('商品名称')).toHaveValue(`${category.name}新商品`);

      await page.getByRole('button', { name: '新建标签' }).click();
      await tagDialog.getByRole('textbox').fill('临时标签');
      await tagDialog.getByRole('button', { name: /保\s*存/ }).click();
      await expect(tagDialog).toBeVisible();
      await expect(tagDialog.getByRole('textbox')).toHaveValue('临时标签');
      await tagDialog.getByRole('button', { name: /取\s*消/ }).click();
    }
    if (slug === 'cabochons') {
      await expect(page.getByRole('heading', { name: '蛋面尺寸' })).toBeVisible();
      await page.getByPlaceholder('例如 11×22×33').fill('11x22');
      await page.getByRole('button', { name: '识别' }).click();
      await expect(page.getByLabel('长')).toHaveValue('11.00');
      await expect(page.getByLabel('宽')).toHaveValue('11.00');
      await expect(page.getByLabel('高')).toHaveValue('22.00');
      await page.getByPlaceholder('例如 11×22×33').fill('11x');
      await page.getByRole('button', { name: '识别' }).click();
      await expect(page.getByLabel('高')).toHaveValue('22.00');
    } else {
      await expect(page.getByRole('heading', { name: '蛋面尺寸' })).toHaveCount(0);
    }
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/${slug}$`));
    expect(writes.at(-1)).toEqual({ method: 'POST', categoryId: category.id });
    expect(productPayloads.at(-1)?.source).toMatchObject({ origin: 'PURCHASED', quantity: 2 });
    expect(productPayloads.at(-1)?.tagIds).toEqual(slug === 'cabochons' ? ['tag-1'] : []);
    expect(productPayloads.at(-1)?.measurement).toEqual(
      slug === 'cabochons' ? { lengthMm: 11, widthMm: 11, heightMm: 22 } : null,
    );

    await page.getByRole('link', { name: `${category.name}测试商品` }).click();
    await expect(
      page
        .locator('.ant-form-item')
        .filter({ hasText: '所属分类' })
        .locator('.ant-select-disabled'),
    ).toHaveCount(slug === 'cabochons' ? 1 : 0);
    await page.getByRole('button', { name: /保\s*存/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/${slug}$`));
    expect(writes.at(-1)).toEqual({ method: 'PUT', categoryId: category.id });
  }

  await page.goto('/zh/admin/products/new');
  await page.getByLabel('所属分类').click();
  await page.locator('.ant-select-dropdown:visible').getByText('蛋面').click();
  await expect(page.getByRole('heading', { name: '蛋面尺寸' })).toBeVisible();
  await page
    .locator('.ant-form-item')
    .filter({ hasText: '所属分类' })
    .locator('.ant-select-selector')
    .click();
  await page.locator('.ant-select-dropdown:visible').getByText('成品串').click();
  await expect(page.getByRole('heading', { name: '蛋面尺寸' })).toHaveCount(0);

  await page.goto('/zh/admin/catalog/cabochons/product-1');
  await expect(page.getByText('此商品不属于“蛋面”分类')).toBeVisible();
  await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0);

  await page.goto('/zh/admin/catalog/finished-strands/product-2');
  await expect(page.getByLabel('商品名称')).toHaveValue('其他饰品测试商品');
  await page.goto('/zh/admin/catalog/finished-strands/product-0');
  await expect(page.getByText('此商品属于“蛋面”分类')).toBeVisible();
  await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0);

  availableCategories = categories.filter((item) => item.name !== '成品串');
  await page.goto('/zh/admin/catalog/finished-strands');
  await expect(page.getByRole('heading', { name: '成品管理' })).toBeVisible();
  await expect(page.getByRole('link', { name: '其他饰品测试商品' })).toBeVisible();
  await page.getByRole('button', { name: '新建商品' }).click();
  await expect(page.getByLabel('所属分类')).toBeEnabled();

  availableCategories = categories.filter((item) => item.name !== '蛋面');
  await page.goto('/zh/admin/catalog/cabochons');
  await expect(page.getByText('请先新增“蛋面”分类')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建商品' })).toHaveCount(0);
  await page.goto('/zh/admin/catalog/cabochons/new');
  await expect(page.getByText('请先新增“蛋面”分类')).toBeVisible();
  await expect(page.getByRole('button', { name: /保\s*存/ })).toHaveCount(0);

  categoriesFail = true;
  await page.goto('/zh/admin/catalog/cabochons');
  await expect(page.getByText('分类加载失败，请重试')).toBeVisible();
  await expect(page.getByText('请先新增“蛋面”分类')).toHaveCount(0);

  categoriesFail = false;
  availableCategories = categories;
  await page.goto('/zh/admin/catalog/cabochons/new');
  await page.getByLabel('商品名称').fill('保存时删除分类');
  await expect(page.locator('.editor-field-code input')).toHaveValue('A0002');
  await page.locator('.editor-field-code input').fill('DELETED-CATEGORY');
  await page.getByLabel('售价（元）').fill('12.50');
  const rejectedSource = page.locator('.product-source-fields').first();
  await rejectedSource
    .locator('.source-field')
    .filter({ hasText: '进货批次' })
    .locator('.ant-select')
    .click();
  await page.locator('.ant-select-dropdown:visible').getByText(batch.name).click();
  await rejectedSource
    .locator('.source-field')
    .filter({ hasText: '来源渠道商' })
    .locator('.ant-select')
    .click();
  await page.locator('.ant-select-dropdown:visible').getByText(distributor.name).click();
  await rejectedSource
    .locator('.source-field')
    .filter({ hasText: '单件成本' })
    .locator('input')
    .fill('5');
  rejectNextSave = true;
  await page.getByRole('button', { name: /保\s*存/ }).click();
  await expect(page.getByText('请先新增“蛋面”分类')).toBeVisible();
});
