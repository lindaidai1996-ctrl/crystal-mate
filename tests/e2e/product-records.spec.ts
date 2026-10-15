import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD for an initialized admin.');

test('marketing and cabochon measurements follow product category changes', async ({ page }) => {
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);

  const categories = await (await page.request.get('/api/categories')).json();
  const existingCabochon = categories.find(
    (category: { name: string }) => category.name === '蛋面',
  );
  const cabochon =
    existingCabochon ??
    (await (await page.request.post('/api/categories', { data: { name: '蛋面' } })).json());
  const other = await (
    await page.request.post('/api/categories', { data: { name: `测试其他${Date.now()}` } })
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
    const created = await page.request.post('/api/products', {
      data: {
        code: `MEASURE-${Date.now()}`,
        name: '测试蛋面',
        description: '',
        categoryId: cabochon.id,
        priceCents: 100,
        currency: 'CNY',
        stock: 1,
        published: false,
        imageKeys: [],
        measurement: { lengthMm: 11.25 },
        source: {
          origin: 'PURCHASED',
          selection: { batchId: batch.id },
          distributorId: distributor.id,
          quantity: 1,
          unitCost: '1.00',
          notes: '',
        },
      },
    });
    expect(created.status()).toBe(201);
    const product = await created.json();
    productId = product.id;
    expect(product.marketing).toMatchObject({
      videoShot: false,
      xiaohongshuVideoPublished: false,
      xiaohongshuListed: false,
      douyinVideoPublished: false,
      douyinListed: false,
    });
    expect(product.measurement).toEqual({ lengthMm: 11.25, widthMm: null, heightMm: null });

    for (const field of ['videoShot', 'xiaohongshuVideoPublished', 'xiaohongshuListed']) {
      const patched = await page.request.patch(`/api/products/${product.id}/marketing`, {
        data: { field, value: true },
      });
      expect(patched.status()).toBe(200);
      expect((await patched.json()).value).toBe(true);
    }
    const afterToggles = await (await page.request.get(`/api/products/${product.id}`)).json();
    expect(afterToggles.marketing).toMatchObject({
      videoShot: true,
      xiaohongshuVideoPublished: true,
      xiaohongshuListed: true,
      douyinVideoPublished: false,
      douyinListed: false,
    });
    expect(afterToggles.measurement).toEqual(product.measurement);
    expect(
      (
        await page.request.patch(`/api/products/${product.id}/marketing`, {
          data: { field: 'douyinListed', value: true },
        })
      ).status(),
    ).toBe(400);

    const renamed = await page.request.put(`/api/categories/${cabochon.id}`, {
      data: { name: `已改名蛋面${Date.now()}` },
    });
    expect(renamed.status()).toBe(409);
    expect((await renamed.json()).error).toBe('CABOCHON_MEASUREMENTS_IN_USE');

    const updated = await page.request.put(`/api/products/${product.id}`, {
      data: {
        code: product.code,
        name: product.name,
        description: product.description,
        categoryId: cabochon.id,
        priceCents: product.priceCents,
        currency: 'CNY',
        stock: product.stock,
        published: product.published,
        imageKeys: [],
        marketing: {
          videoShot: true,
          xiaohongshuVideoPublished: false,
          xiaohongshuListed: false,
          douyinVideoPublished: false,
          douyinListed: false,
        },
        measurement: { heightMm: 5 },
      },
    });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).measurement).toEqual({
      lengthMm: null,
      widthMm: null,
      heightMm: 5,
    });

    const moved = await page.request.put(`/api/products/${product.id}`, {
      data: {
        code: product.code,
        name: product.name,
        description: product.description,
        categoryId: other.id,
        priceCents: product.priceCents,
        currency: 'CNY',
        stock: product.stock,
        published: product.published,
        imageKeys: [],
      },
    });
    expect(moved.status()).toBe(200);
    expect((await moved.json()).measurement).toBeNull();
    expect(
      (
        await page.request.patch(`/api/products/${product.id}/marketing`, {
          data: { field: 'videoShot', value: false },
        })
      ).status(),
    ).toBe(400);
    expect(
      (await (await page.request.get(`/api/products/${product.id}`)).json()).marketing,
    ).toMatchObject({
      videoShot: true,
    });
  } finally {
    if (productId) await page.request.delete(`/api/products/${productId}`);
    await page.request.delete(`/api/material-batches/${batch.id}`);
    await page.request.delete(`/api/distributors/${distributor.id}`);
    await page.request.delete(`/api/categories/${other.id}`);
    if (!existingCabochon) await page.request.delete(`/api/categories/${cabochon.id}`);
  }
});
