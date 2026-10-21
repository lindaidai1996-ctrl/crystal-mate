import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD for an initialized admin.');

test('material categories, pricing, and upload grants work together', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/zh/login');
  await page.getByLabel('账号').fill(username!);
  await page.getByLabel('密码').fill(password!);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/zh\/admin\/products/, { timeout: 20000 });

  const suffix = Date.now();
  const childName = `测试紫发晶${suffix}`;
  const parentResponse = await page.request.post('/api/material-categories', {
    data: { name: `测试晶石${suffix}`, aliases: [], parentId: null },
  });
  expect(parentResponse.status()).toBe(201);
  const parent = await parentResponse.json();
  let childId: string | undefined;
  let grandchildId: string | undefined;
  let distributorId: string | undefined;
  let secondDistributorId: string | undefined;
  const materialIds: string[] = [];
  const batchIds: string[] = [];
  const db = new PrismaClient();
  let grantId: string | undefined;

  try {
    const childResponse = await page.request.post('/api/material-categories', {
      data: { name: childName, aliases: [`测试紫发${suffix}`], parentId: parent.id },
    });
    expect(childResponse.status()).toBe(201);
    const child = await childResponse.json();
    childId = child.id;

    const distributorResponse = await page.request.post('/api/distributors', {
      data: {
        name: `测试可塘${suffix}`,
        area: '测试地区',
        address: '',
        wechat: '',
        phone: '',
        notes: '',
      },
    });
    expect(distributorResponse.status()).toBe(201);
    distributorId = (await distributorResponse.json()).id;
    const secondDistributorResponse = await page.request.post('/api/distributors', {
      data: {
        name: `测试东海${suffix}`,
        area: '测试地区',
        address: '',
        wechat: '',
        phone: '',
        notes: '',
      },
    });
    expect(secondDistributorResponse.status()).toBe(201);
    secondDistributorId = (await secondDistributorResponse.json()).id;

    const legacy = await db.material.create({
      data: {
        name: `测试旧物料${suffix}`,
        categoryId: child.id,
        unit: 'BEAD',
        purchaseGramPrice: '7.00',
        saleUnitPrice: '30.00',
      },
    });
    materialIds.push(legacy.id);
    const legacyResponse = await (await page.request.get(`/api/materials/${legacy.id}`)).json();
    expect(legacyResponse.batchEntries).toEqual([]);
    expect(legacyResponse).toMatchObject({ purchaseGramPrice: '7.00', saleUnitPrice: '30.00' });

    const cycle = await page.request.put(`/api/material-categories/${parent.id}`, {
      data: { name: parent.name, aliases: [], parentId: child.id },
    });
    expect(cycle.status()).toBe(400);
    expect((await cycle.json()).error).toBe('MATERIAL_CATEGORY_CYCLE');

    const payload = {
      name: `测试紫发晶串${suffix}`,
      categoryId: child.id,
      unit: 'STRAND',
      purchaseUnitPrice: '100.00',
      weightGrams: '20.00',
      purchaseGramPrice: '5.00',
      purchaseGramManual: false,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      childCount: 10,
      childWeightGrams: '2.00',
      childUnitPrice: '10.00',
      childPriceSource: 'COUNT',
      saleRule: 'FIXED_AMOUNT',
      saleRuleValue: '20.00',
      saleUnitPrice: '120.00',
      saleGramPrice: '6.00',
      saleChildUnitPrice: '12.00',
      saleUnitManual: false,
      saleGramManual: false,
      saleChildManual: false,
      notes: '',
      imageKeys: [],
    };
    const batchName = `2026年6月可塘进货${suffix}`;
    const firstBatch = { name: batchName, receivedAt: '2026-06-01', notes: '' };
    const invalidImage = await page.request.post('/api/materials', {
      data: {
        values: { ...payload, imageKeys: ['not-uploaded'] },
        selection: { newBatch: firstBatch },
        distributorId,
        receivedQty: 5,
      },
    });
    expect(invalidImage.status()).toBe(400);
    expect((await invalidImage.json()).error).toBe('INVALID_IMAGE');

    const created = await page.request.post('/api/materials', {
      data: { values: payload, selection: { newBatch: firstBatch }, distributorId, receivedQty: 5 },
    });
    expect(created.status()).toBe(201);
    const material = await created.json();
    materialIds.push(material.id);
    const firstEntry = material.batchEntries[0];
    batchIds.push(firstEntry.batchId);
    expect(firstEntry).toMatchObject({
      receivedQty: 5,
      remainingQty: 5,
      purchaseGramPrice: '5.00',
      childUnitPrice: '10.00',
      saleUnitPrice: '120.00',
      saleGramPrice: '6.00',
      saleChildUnitPrice: '12.00',
    });

    const duplicateName = await page.request.post('/api/material-batches', { data: firstBatch });
    expect(duplicateName.status()).toBe(409);
    expect((await duplicateName.json()).error).toBe('MATERIAL_BATCH_NAME_EXISTS');
    const secondMaterial = await page.request.post('/api/materials', {
      data: {
        values: { ...payload, name: `测试白水晶串${suffix}` },
        selection: { batchId: firstEntry.batchId },
        distributorId: secondDistributorId,
        receivedQty: 3,
      },
    });
    expect(secondMaterial.status()).toBe(201);
    const secondMaterialData = await secondMaterial.json();
    materialIds.push(secondMaterialData.id);
    expect(secondMaterialData.batchEntries[0].distributorId).toBe(secondDistributorId);
    expect(
      (await (await page.request.get(`/api/material-batches/${firstEntry.batchId}`)).json())
        .entries,
    ).toHaveLength(2);
    expect((await page.request.delete(`/api/distributors/${distributorId}`)).status()).toBe(409);
    expect((await page.request.delete(`/api/distributors/${secondDistributorId}`)).status()).toBe(
      409,
    );
    const sameBatch = await page.request.post(`/api/materials/${material.id}/batches`, {
      data: {
        values: payload,
        selection: { batchId: firstEntry.batchId },
        distributorId,
        receivedQty: 1,
      },
    });
    expect(sameBatch.status()).toBe(409);
    expect((await sameBatch.json()).error).toBe('MATERIAL_ALREADY_IN_BATCH');
    const invalidDistributor = await page.request.post(`/api/materials/${material.id}/batches`, {
      data: {
        values: payload,
        selection: { newBatch: { ...firstBatch, name: `无效来源${suffix}` } },
        distributorId: 'clx1234567890123456789012',
        receivedQty: 1,
      },
    });
    expect(invalidDistributor.status()).toBe(400);
    expect((await invalidDistributor.json()).error).toBe('DISTRIBUTOR_NOT_FOUND');

    for (const [index, date] of ['2026-07-01', '2026-08-01'].entries()) {
      const added = await page.request.post(`/api/materials/${material.id}/batches`, {
        data: {
          values: payload,
          selection: {
            newBatch: { ...firstBatch, name: `测试批次${index + 2}-${suffix}`, receivedAt: date },
          },
          distributorId,
          receivedQty: 2,
        },
      });
      expect(added.status(), `batch ${index + 2}: ${JSON.stringify(await added.json())}`).toBe(201);
      batchIds.push((await added.json()).batchId);
    }

    const filtered = await (
      await page.request.get(`/api/materials?categoryId=${parent.id}`)
    ).json();
    expect(filtered.items.some((item: { id: string }) => item.id === material.id)).toBe(true);
    expect((await page.request.delete(`/api/material-categories/${parent.id}`)).status()).toBe(409);
    expect(
      (
        await page.request.put(`/api/materials/${material.id}`, {
          data: { name: payload.name, categoryId: child.id, unit: 'BEAD', notes: '' },
        })
      ).status(),
    ).toBe(409);

    await page.goto('/zh/admin/materials');
    await expect(page.getByRole('heading', { name: '原物料管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: payload.name })).toBeVisible();
    const singleBatchRow = page.getByRole('row', { name: new RegExp(secondMaterialData.name) });
    await expect(singleBatchRow).toContainText('进货单价: 100.00 · 进货克价: 5.00');
    const materialRow = page.getByRole('row', { name: new RegExp(payload.name) });
    await expect(materialRow).toContainText('进货单价: 100.00 · 进货克价: 5.00');
    await expect(materialRow.getByRole('button', { name: /查看更多/ })).toBeVisible();
    await materialRow.getByRole('button', { name: /查看更多/ }).click();
    await expect(page.getByRole('link', { name: `测试批次2-${suffix}` }).last()).toBeVisible();

    const imageKey = `images/${randomUUID()}.png`;
    const grant = await db.uploadGrant.create({
      data: {
        objectKey: imageKey,
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
        uploadedAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    grantId = grant.id;
    const changed = await page.request.post(`/api/materials/${material.id}/batches`, {
      data: {
        values: { ...payload, purchaseUnitPrice: '200.00', imageKeys: [imageKey] },
        selection: {
          newBatch: { ...firstBatch, name: `测试批次4-${suffix}`, receivedAt: '2026-09-01' },
        },
        distributorId,
        receivedQty: 4,
      },
    });
    expect(changed.status()).toBe(201);
    const changedEntry = await changed.json();
    batchIds.push(changedEntry.batchId);
    expect(changedEntry.images[0].objectKey).toBe(imageKey);
    const reusedImage = await page.request.post(`/api/materials/${material.id}/batches`, {
      data: {
        values: { ...payload, purchaseUnitPrice: '200.00', imageKeys: [imageKey] },
        selection: {
          newBatch: { ...firstBatch, name: `测试批次5-${suffix}`, receivedAt: '2026-08-15' },
        },
        distributorId,
        receivedQty: 1,
      },
    });
    expect(reusedImage.status()).toBe(201);
    const reusedEntry = await reusedImage.json();
    batchIds.push(reusedEntry.batchId);
    expect(reusedEntry.images[0].objectKey).toBe(imageKey);
    await page.reload();
    await expect(page.getByRole('row', { name: new RegExp(payload.name) })).toContainText(
      '进货单价: 200.00 · 进货克价: 10.00',
    );
    await expect(
      page
        .getByRole('row', { name: new RegExp(payload.name) })
        .getByText('10.00')
        .first(),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: '/private/tmp/crystal-material-list-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    await page
      .getByRole('row', { name: new RegExp(payload.name) })
      .getByRole('button', { name: '添加批次' })
      .click();
    await expect(page.getByRole('heading', { name: '添加物料批次' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '进货单价' })).toHaveValue('200.00');
    await expect(page.getByRole('spinbutton', { name: '进货数量' })).toBeEmpty();
    await expect(page.locator('.image-item img')).toHaveCount(1);

    await page.goto(`/zh/admin/materials/${material.id}/batches/${firstEntry.id}`);
    await expect(page.getByRole('heading', { name: '编辑物料批次' })).toBeVisible();
    await expect(page.getByText('已采纳按数量计算')).toBeVisible();
    await page.getByRole('spinbutton', { name: '进货单价' }).fill('120');
    await expect(page.getByRole('spinbutton', { name: '进货克价' })).toHaveValue('6.00');
    await expect(
      page.getByRole('spinbutton', { name: '子物料单价', exact: true }).first(),
    ).toHaveValue('12.00');
    await expect(page.getByRole('spinbutton', { name: '单价', exact: true })).toHaveValue('140.00');
    const updatedFirst = await page.request.put(
      `/api/materials/${material.id}/batches/${firstEntry.id}`,
      {
        data: {
          values: { ...payload, purchaseUnitPrice: '120.00' },
          distributorId,
          receivedQty: 5,
        },
      },
    );
    expect(updatedFirst.status()).toBe(200);
    expect((await updatedFirst.json()).saleUnitPrice).toBe('140.00');
    const otherEntry = await (await page.request.get(`/api/materials/${material.id}`)).json();
    expect(
      otherEntry.batchEntries.find((item: { batchId: string }) => item.batchId === batchIds[1])
        .purchaseUnitPrice,
    ).toBe('100.00');
    await page.screenshot({
      path: '/private/tmp/crystal-material-editor-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: '编辑物料批次' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: '/private/tmp/crystal-material-editor-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/zh/admin/materials/new');
    const batchSelect = page.getByRole('combobox', { name: '选择进货批次' });
    await batchSelect.click();
    await batchSelect.fill(batchName);
    await batchSelect.press('Enter');
    await expect(page.getByText(new RegExp(batchName)).last()).toBeVisible();
    await page.getByRole('textbox', { name: '物料名称' }).fill(`天然${childName}手串`);
    await page.getByRole('button', { name: '智能识别' }).click();
    await expect(page.getByText(`已匹配分类：${childName}`)).toBeVisible();
    await page.goto('/zh/admin/materials/categories');
    await expect(page.getByRole('row', { name: new RegExp(childName) })).toBeVisible();
    await page
      .getByRole('row', { name: new RegExp(childName) })
      .getByRole('button', { name: '添加子类' })
      .click();
    const categoryDialog = page.getByRole('dialog', { name: '新建物料分类' });
    await expect(categoryDialog).toBeVisible();
    await expect(categoryDialog.getByText(new RegExp(childName))).toBeVisible();
    await categoryDialog.getByLabel('分类名称').fill(`测试子类${suffix}`);
    await categoryDialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(categoryDialog).not.toBeVisible();
    const categories = await (await page.request.get('/api/material-categories')).json();
    const grandchild = categories.find(
      (item: { name: string }) => item.name === `测试子类${suffix}`,
    );
    grandchildId = grandchild?.id;
    expect(grandchild?.parentId).toBe(child.id);

    await page.goto('/zh/admin/materials/batches');
    await expect(page.getByRole('heading', { name: '进货批次管理' })).toBeVisible();
    await page.getByRole('searchbox', { name: '搜索批次名称' }).fill(batchName);
    const batchRow = page.getByRole('row', { name: new RegExp(batchName) });
    await batchRow.getByRole('button', { name: `编辑 ${batchName}` }).click();
    const batchDialog = page.getByRole('dialog', { name: '编辑批次' });
    const updatedBatchName = `${batchName}已调整`;
    await batchDialog.getByLabel('批次名称').fill(updatedBatchName);
    await batchDialog.getByLabel('到货日期').fill('2026-06-03');
    await batchDialog.getByLabel('备注', { exact: true }).fill('六月共同备注');
    await batchDialog.locator('input[type="file"]').setInputFiles({
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
    await expect(batchDialog.getByText('采购单.png')).toBeVisible();
    await batchDialog.getByLabel('采购单.png 附件备注').fill('采购单照片');
    await batchDialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(batchDialog).not.toBeVisible();
    const batchDetail = await (
      await page.request.get(`/api/material-batches/${firstEntry.batchId}`)
    ).json();
    expect(batchDetail).toMatchObject({
      name: updatedBatchName,
      notes: '六月共同备注',
      attachments: [{ fileName: '采购单.png', notes: '采购单照片' }],
    });
    expect(batchDetail.receivedAt.slice(0, 10)).toBe('2026-06-03');
    expect(
      batchDetail.entries.map((entry: { distributorId: string }) => entry.distributorId),
    ).toEqual(expect.arrayContaining([distributorId, secondDistributorId]));
    const crossBatchAttachment = await page.request.put(`/api/material-batches/${batchIds[1]}`, {
      data: {
        name: `测试批次2-${suffix}`,
        receivedAt: '2026-07-01',
        notes: '',
        attachments: [
          {
            objectKey: batchDetail.attachments[0].objectKey,
            fileName: '借用图片.png',
            notes: '',
          },
        ],
      },
    });
    expect(crossBatchAttachment.status()).toBe(400);
    expect((await crossBatchAttachment.json()).error).toBe('INVALID_IMAGE');
    const tooManyAttachments = await page.request.put(
      `/api/material-batches/${firstEntry.batchId}`,
      {
        data: {
          name: updatedBatchName,
          receivedAt: '2026-06-03',
          notes: '六月共同备注',
          attachments: Array(13).fill({
            objectKey: batchDetail.attachments[0].objectKey,
            fileName: '采购单.png',
            notes: '',
          }),
        },
      },
    );
    expect(tooManyAttachments.status()).toBe(400);

    await page.goto(`/zh/admin/materials/batches/${firstEntry.batchId}`);
    await expect(page.getByText('采购单照片')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '进货单价' })).toBeVisible();
    await expect(
      page
        .getByRole('row', { name: new RegExp(payload.name) })
        .getByRole('cell', { name: '120.00' }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: new RegExp(secondMaterialData.name) }),
    ).toContainText(`测试东海${suffix}`);
    await page.getByRole('button', { name: '编辑' }).first().click();
    const removeDialog = page.getByRole('dialog', { name: '编辑批次' });
    await removeDialog.getByRole('button', { name: '移除附件 采购单.png' }).click();
    await removeDialog.getByRole('button', { name: /保\s*存/ }).click();
    await expect(removeDialog).not.toBeVisible();
    expect(
      (await (await page.request.get(`/api/material-batches/${firstEntry.batchId}`)).json())
        .attachments,
    ).toHaveLength(0);
    expect(
      (await page.request.delete(`/api/material-batches/${firstEntry.batchId}`)).status(),
    ).toBe(409);
  } finally {
    for (const materialId of materialIds) {
      const current = await (await page.request.get(`/api/materials/${materialId}`)).json();
      for (const entry of current.batchEntries) {
        await page.request.delete(`/api/materials/${materialId}/batches/${entry.id}`);
      }
      await page.request.delete(`/api/materials/${materialId}`);
    }
    for (const batchId of batchIds) await page.request.delete(`/api/material-batches/${batchId}`);
    if (grantId) await db.uploadGrant.delete({ where: { id: grantId } });
    await db.$disconnect();
    if (distributorId) await page.request.delete(`/api/distributors/${distributorId}`);
    if (secondDistributorId) await page.request.delete(`/api/distributors/${secondDistributorId}`);
    if (grandchildId) await page.request.delete(`/api/material-categories/${grandchildId}`);
    if (childId) await page.request.delete(`/api/material-categories/${childId}`);
    await page.request.delete(`/api/material-categories/${parent.id}`);
  }
});
