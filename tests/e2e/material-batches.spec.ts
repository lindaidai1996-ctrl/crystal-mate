import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD.');

test('batch management saves private image attachments and notes', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/, { timeout: 20000 });

  const suffix = Date.now();
  const name = `测试采购批次${suffix}`;
  const renamed = `${name}已更新`;
  let batchId: string | undefined;
  let otherBatchId: string | undefined;
  try {
    await page.goto('/zh/admin/materials/batches');
    const createButton = page.getByRole('button', { name: /新建批次/ });
    await expect(createButton).toBeEnabled();
    await createButton.click();
    const create = page.getByRole('dialog', { name: '新建批次' });
    await expect(create).toBeVisible({ timeout: 5000 });
    await create.getByLabel('批次名称').fill(name);
    await create.getByLabel('到货日期').fill('2026-06-01');
    await create.getByLabel('备注', { exact: true }).fill('共同备注');
    await create.locator('input[type="file"]').setInputFiles({
      name: '采购单.png',
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
    await expect(create.getByText('采购单.png')).toBeVisible();
    await create.getByLabel('采购单.png 附件备注').fill('已核对');
    await create.getByRole('button', { name: /保\s*存/ }).click();
    await expect(create).not.toBeVisible();

    const batches = await (await page.request.get('/api/material-batches')).json();
    const saved = batches.find((batch: { name: string }) => batch.name === name);
    batchId = saved?.id;
    expect(saved?._count).toMatchObject({ entries: 0, attachments: 1 });
    expect(saved?.attachments).toMatchObject([{ fileName: '采购单.png', notes: '已核对' }]);

    const duplicate = await page.request.post('/api/material-batches', {
      data: { name, receivedAt: '2026-06-02', notes: '' },
    });
    expect(duplicate.status()).toBe(409);
    otherBatchId = (
      await (
        await page.request.post('/api/material-batches', {
          data: { name: `另一个批次${suffix}`, receivedAt: '2026-07-01', notes: '' },
        })
      ).json()
    ).id;
    const borrowed = await page.request.put(`/api/material-batches/${otherBatchId}`, {
      data: {
        name: `另一个批次${suffix}`,
        receivedAt: '2026-07-01',
        notes: '',
        attachments: [
          { objectKey: saved.attachments[0].objectKey, fileName: '借用.png', notes: '' },
        ],
      },
    });
    expect(borrowed.status()).toBe(400);
    expect((await borrowed.json()).error).toBe('INVALID_IMAGE');

    await page
      .getByRole('row', { name: new RegExp(name) })
      .getByRole('button', { name: `编辑 ${name}` })
      .click();
    const edit = page.getByRole('dialog', { name: '编辑批次' });
    await edit.getByLabel('批次名称').fill(renamed);
    await edit.getByLabel('到货日期').fill('2026-06-03');
    await edit.getByLabel('采购单.png 附件备注').fill('已归档');
    await edit.getByRole('button', { name: /保\s*存/ }).click();
    await expect(edit).not.toBeVisible();
    const updated = await (await page.request.get(`/api/material-batches/${batchId}`)).json();
    expect(updated).toMatchObject({
      name: renamed,
      notes: '共同备注',
      attachments: [{ fileName: '采购单.png', notes: '已归档' }],
    });
    expect(updated.receivedAt.slice(0, 10)).toBe('2026-06-03');

    await page.goto(`/zh/admin/materials/batches/${batchId}`);
    await expect(page.getByText('已归档')).toBeVisible();
    await page.getByRole('button', { name: '编辑' }).click();
    const remove = page.getByRole('dialog', { name: '编辑批次' });
    await remove.getByRole('button', { name: '移除附件 采购单.png' }).click();
    await remove.getByRole('button', { name: /保\s*存/ }).click();
    await expect(remove).not.toBeVisible();
    expect(
      (await (await page.request.get(`/api/material-batches/${batchId}`)).json()).attachments,
    ).toHaveLength(0);
  } finally {
    if (batchId) await page.request.delete(`/api/material-batches/${batchId}`);
    if (otherBatchId) await page.request.delete(`/api/material-batches/${otherBatchId}`);
  }
});
