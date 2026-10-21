import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD.');

test('image choice cancels without a grant and uploads an oversized source as WebP', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);
  await page.goto('/zh/admin/distributors');
  await page.getByRole('button', { name: '新增渠道商' }).click();
  const form = page.getByRole('dialog', { name: '新增渠道商' });
  const input = form.locator('input[type="file"]');
  const png = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#27a887';
      context.fillRect(0, 0, 1, 1);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), 'image/png'),
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    }),
  );
  const grants: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/uploads' && request.method() === 'POST')
      grants.push(request.url());
  });

  await input.setInputFiles({ name: 'cancel.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: '保留整图', exact: true }).click();
  let choice = page.getByRole('dialog', { name: '选择上传图片版本' });
  await expect(choice).toBeVisible();
  await choice.getByRole('button', { name: /取\s*消/ }).click();
  await expect(choice).not.toBeVisible();
  expect(grants).toHaveLength(0);

  await input.setInputFiles({
    name: 'proof.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]),
  });
  await page.getByRole('button', { name: '保留整图', exact: true }).click();
  choice = page.getByRole('dialog', { name: '选择上传图片版本' });
  await expect(choice.getByText(/压缩后/)).toBeVisible();
  await expect(choice.locator('.ant-segmented-item-disabled')).toContainText('原图');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(choice).toBeInViewport({ ratio: 0.99 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await choice.getByRole('button', { name: '上传所选版本' }).click();
  await expect(form.getByText('proof.webp')).toBeVisible();
  expect(grants).toHaveLength(1);

  const name = `图片压缩测试${Date.now()}`;
  let distributorId: string | undefined;
  try {
    await form.getByLabel('渠道商名称').fill(name);
    await form.getByLabel('归属地').fill('东海');
    await form.getByRole('button', { name: /保\s*存/ }).click();
    await expect(form).not.toBeVisible();
    const data = await (await page.request.get('/api/distributors')).json();
    const saved = data.items.find((item: { name: string }) => item.name === name);
    distributorId = saved?.id;
    expect(saved?.attachments).toMatchObject([{ fileName: 'proof.webp' }]);
    expect(saved.attachments[0].objectKey).toMatch(/\.webp$/);
    const image = await page.request.get(saved.attachments[0].url);
    expect(image.ok()).toBe(true);
    const bytes = await image.body();
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  } finally {
    if (distributorId) await page.request.delete(`/api/distributors/${distributorId}`);
  }
});
