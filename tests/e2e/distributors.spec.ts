import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD for an initialized admin.');

test('distributor details and custom areas persist', async ({ page }) => {
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/);
  await page.goto('/zh/admin/distributors');
  await expect(page.getByRole('heading', { name: '渠道商管理' })).toBeVisible();

  const name = `测试渠道商${Date.now()}`;
  const area = '测试归属地';
  let distributorId: string | undefined;

  try {
    await page.getByRole('button', { name: '新增渠道商' }).click();
    const dialog = page.getByRole('dialog', { name: '新增渠道商' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.ant-drawer-right')).toBeVisible();
    await expect(dialog).toBeInViewport({ ratio: 0.99 });
    await page.screenshot({ path: '/private/tmp/crystal-distributor-drawer-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeInViewport({ ratio: 0.99 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/private/tmp/crystal-distributor-drawer-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('渠道商名称').fill(name);
    await dialog.getByLabel('归属地').fill(area);
    await dialog.getByLabel('详细地址').fill('东海县测试路 1 号');
    await dialog.getByLabel('微信号').fill('test_wechat');
    await dialog.getByLabel('手机号').fill('13800138000');
    await dialog.getByLabel('备注信息').fill('测试备注');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: '渠道证明.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: '保留整图', exact: true }).click();
    const imageChoice = page.getByRole('dialog', { name: '选择上传图片版本' });
    await expect(imageChoice).toBeVisible();
    await imageChoice.getByText('原图', { exact: true }).click();
    await imageChoice.getByRole('button', { name: '上传所选版本' }).click();
    await expect(dialog.getByText('渠道证明.png')).toBeVisible();
    await dialog.getByLabel('渠道证明.png 附件备注').fill('已核对');
    await dialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    await page.screenshot({
      path: '/private/tmp/crystal-distributors-desktop.png',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/private/tmp/crystal-distributors-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });

    const data = await (await page.request.get('/api/distributors')).json();
    const distributor = data.items.find((item: { name: string }) => item.name === name);
    distributorId = distributor?.id;
    expect(distributor).toMatchObject({
      area,
      address: '东海县测试路 1 号',
      wechat: 'test_wechat',
      phone: '13800138000',
      notes: '测试备注',
      attachments: [{ fileName: '渠道证明.png', notes: '已核对' }],
    });
    expect(distributor._count.attachments).toBe(1);
    expect(data.areas).toContain(area);

    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: '编辑' }).click();
    const editDialog = page.getByRole('dialog', { name: '编辑渠道商' });
    await editDialog.getByLabel('备注信息').fill('已更新备注');
    await editDialog.getByLabel('渠道证明.png 附件备注').fill('已归档');
    await editDialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(editDialog).not.toBeVisible();

    const updated = (await (await page.request.get('/api/distributors')).json()).items.find(
      (item: { id: string }) => item.id === distributorId,
    );
    expect(updated.attachments).toMatchObject([{ fileName: '渠道证明.png', notes: '已归档' }]);

    const borrowed = await page.request.post('/api/distributors', {
      data: {
        name: `${name}副本`,
        area,
        address: '',
        wechat: '',
        phone: '',
        notes: '',
        attachments: [
          { objectKey: updated.attachments[0].objectKey, fileName: '借用.png', notes: '' },
        ],
      },
    });
    expect(borrowed.status()).toBe(400);
    expect((await borrowed.json()).error).toBe('INVALID_IMAGE');

    await row.getByRole('button', { name: '编辑' }).click();
    const removeDialog = page.getByRole('dialog', { name: '编辑渠道商' });
    await removeDialog.getByRole('button', { name: '移除附件 渠道证明.png' }).click();
    await removeDialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(removeDialog).not.toBeVisible();
    const withoutAttachment = (
      await (await page.request.get('/api/distributors')).json()
    ).items.find((item: { id: string }) => item.id === distributorId);
    expect(withoutAttachment.attachments).toHaveLength(0);

    await page.getByRole('button', { name: '新增渠道商' }).click();
    const newDialog = page.getByRole('dialog', { name: '新增渠道商' });
    await newDialog.getByLabel('归属地').fill(area);
    await expect(
      page
        .locator('.ant-select-dropdown:visible .ant-select-item-option')
        .filter({ hasText: area }),
    ).toBeVisible();
    await newDialog.getByRole('button', { name: /取\s*消/ }).click();
  } finally {
    if (distributorId) {
      await page.request.delete(`/api/distributors/${distributorId}`);
    }
  }

  const afterDelete = await (await page.request.get('/api/distributors')).json();
  expect(afterDelete.areas).toContain(area);
});

test('areas can be managed without losing distributor assignments', async ({ page }) => {
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.goto('/zh/admin/distributors');

  const suffix = Date.now();
  const initialArea = `测试归属地${suffix}`;
  const renamedArea = `已更名归属地${suffix}`;
  const name = `测试渠道商${suffix}`;
  let areaId: string | undefined;
  let distributorId: string | undefined;

  try {
    await page.getByRole('button', { name: '归属地管理' }).click();
    const manager = page.getByRole('dialog', { name: '归属地管理' });
    await expect(manager).toBeVisible();
    await manager.getByRole('button', { name: '新增归属地' }).click();
    const form = page.getByRole('dialog', { name: '新增归属地' });
    await form.getByLabel('归属地').fill(initialArea);
    await form.getByRole('button', { name: /保\s*存/ }).click();
    await expect(manager.getByRole('row', { name: new RegExp(initialArea) })).toBeVisible();

    const areas = await (await page.request.get('/api/distributors')).json();
    areaId = areas.areaItems.find((item: { name: string }) => item.name === initialArea)?.id;
    expect(areaId).toBeTruthy();

    await page.keyboard.press('Escape');
    await expect(manager).not.toBeVisible();
    await page.getByRole('button', { name: '新增渠道商' }).click();
    const distributorForm = page.getByRole('dialog', { name: '新增渠道商' });
    await distributorForm.getByLabel('渠道商名称').fill(name);
    await distributorForm.getByLabel('归属地').fill(initialArea);
    await distributorForm.getByRole('button', { name: /保\s*存/ }).click();
    const data = await (await page.request.get('/api/distributors')).json();
    distributorId = data.items.find((item: { name: string }) => item.name === name)?.id;
    expect(distributorId).toBeTruthy();

    await page.getByRole('button', { name: '归属地管理' }).click();
    const row = manager.getByRole('row', { name: new RegExp(initialArea) });
    await expect(row).toContainText('1');
    await row.getByRole('button', { name: '编辑' }).click();
    const editForm = page.getByRole('dialog', { name: '编辑归属地' });
    await editForm.getByLabel('归属地').fill(renamedArea);
    await editForm.getByRole('button', { name: /保\s*存/ }).click();
    await expect(manager.getByRole('row', { name: new RegExp(renamedArea) })).toBeVisible();

    const afterRename = await (await page.request.get('/api/distributors')).json();
    expect(afterRename.items.find((item: { id: string }) => item.id === distributorId)?.area).toBe(
      renamedArea,
    );
    const blockedDelete = await page.request.delete(`/api/distributor-areas/${areaId}`);
    expect(blockedDelete.status()).toBe(409);

    await page.request.delete(`/api/distributors/${distributorId}`);
    distributorId = undefined;
    const renamedRow = manager.getByRole('row', { name: new RegExp(renamedArea) });
    await renamedRow.getByRole('button', { name: '删除' }).click();
    await page
      .getByRole('button', { name: /删\s*除/ })
      .last()
      .click();
    await expect(renamedRow).not.toBeVisible();
    areaId = undefined;
  } finally {
    if (distributorId) await page.request.delete(`/api/distributors/${distributorId}`);
    if (areaId) await page.request.delete(`/api/distributor-areas/${areaId}`);
  }
});
