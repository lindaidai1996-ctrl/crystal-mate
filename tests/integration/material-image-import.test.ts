import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
const mocks = vi.hoisted(() => ({ recognize: vi.fn() }));
vi.mock('@/lib/ai/imageRecognition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/imageRecognition')>()),
  recognizeImage: mocks.recognize,
}));
vi.mock('@/lib/materialImageImport/sourceImage', () => ({
  readImportSource: vi
    .fn()
    .mockResolvedValue({ bytes: Buffer.from('fixture'), mimeType: 'image/png' }),
}));
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import {
  createImageImport,
  recognizeImageImport,
  saveImageImport,
  getImageImport,
  commitImageImportItem,
  deleteImageImport,
} from '@/lib/materialImageImport/store';
import { newImportItem, type ImageImport } from '@/lib/materialImageImport/contracts';
import { importMaterialDraft } from '@/lib/materialImageImport/materialDraft';
import { materialImageImportSources } from '@/lib/materialImageImport/materialSources';
import { materialInclude, serializeMaterial } from '@/lib/materials';
import { imageStorageUrl, imageUploadPrefixes, type ImageUploadPurpose } from '@/lib/image-storage';
import { materialBatchWriteSchema } from '@/lib/validation';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
const prefix = `图片导入验证-${crypto.randomUUID()}`;
const jobs: string[] = [];
const keys: string[] = [];
const materials: string[] = [];
let categoryId: string;
let distributorId: string;

async function grant(purpose: ImageUploadPurpose = 'import-crop') {
  const objectKey = `${imageUploadPrefixes[purpose]}/${crypto.randomUUID()}.png`;
  keys.push(objectKey);
  return db.uploadGrant.create({
    data: {
      objectKey,
      url: imageStorageUrl(objectKey, 'cos'),
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
}
async function job(purpose: ImageUploadPurpose = 'import-source') {
  const source = await grant(purpose);
  const created = await createImageImport({
    sourceKey: source.objectKey,
    fileName: 'supplier.png',
    width: 1280,
    height: 960,
    provider: 'deepseek',
    priceKind: 'PURCHASE',
  });
  jobs.push(created.id);
  return created;
}
function draft(current: ImageImport) {
  return {
    version: current.version,
    settings: current.settings,
    items: current.items.map(({ id, data }) => ({ id, data })),
  };
}

describe.skipIf(!enabled)('image import purchase transactions', () => {
  beforeAll(async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-key');
    categoryId = (await db.materialCategory.create({ data: { name: prefix } })).id;
    distributorId = (await db.distributor.create({ data: { name: prefix, area: '网络' } })).id;
  });

  afterAll(async () => {
    for (const id of jobs) {
      const item = await db.materialImageImport.findUnique({
        where: { id },
        include: { items: true },
      });
      for (const row of item?.items ?? []) if (row.materialId) materials.push(row.materialId);
    }
    await db.materialImageImport.deleteMany({ where: { id: { in: jobs } } });
    await db.materialBatchAttachment.deleteMany({ where: { objectKey: { in: keys } } });
    await db.materialBatchEntry.deleteMany({ where: { materialId: { in: materials } } });
    await db.material.deleteMany({ where: { id: { in: materials } } });
    await db.materialBatch.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.uploadGrant.deleteMany({ where: { objectKey: { in: keys } } });
    if (categoryId) await db.materialCategory.delete({ where: { id: categoryId } });
    if (distributorId) await db.distributor.delete({ where: { id: distributorId } });
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  it('keeps drafts out of stock, reuses held source images, and commits new/existing materials exactly once', async () => {
    let current = await job();
    const sourceKey = keys[keys.length - 1];
    expect(
      (await db.uploadGrant.findUniqueOrThrow({ where: { objectKey: sourceKey } })).usedAt,
    ).not.toBeNull();
    await db.uploadGrant.update({
      where: { objectKey: sourceKey },
      data: { expiresAt: new Date(0) },
    });
    mocks.recognize.mockResolvedValueOnce({
      model: 'fixture',
      warnings: [],
      items: [newImportItem('PURCHASE'), newImportItem('SALE')],
    });
    current = await recognizeImageImport(current.id, {
      version: current.version,
      provider: 'deepseek',
    });
    const existing = await db.material.create({
      data: { name: `${prefix}-existing`, aliases: ['原有叫法'], categoryId, unit: 'BEAD' },
    });
    materials.push(existing.id);
    current.settings = {
      distributorId,
      priceKind: 'PURCHASE',
      selection: { newBatch: { name: `${prefix}-batch`, receivedAt: '2026-10-21', notes: '' } },
    };
    current.items[0].data = {
      ...current.items[0].data,
      name: `${prefix}-new`,
      categoryId,
      quantity: 3,
      price: '4.50',
      reviewed: true,
    };
    current.items[1].data = {
      ...current.items[1].data,
      existingMaterialId: existing.id,
      name: existing.name,
      categoryId,
      quantity: 5,
      price: '9.00',
      purchasePrice: '6.00',
      reviewed: true,
    };
    const form = importMaterialDraft(current.items[0].data);
    form.values = {
      ...form.values,
      saleRule: 'PERCENT_60',
      lengthMm: '12.50',
      notes: '完整表单备注',
      aliases: [' 蓝色千层 ', 'Blue phantom', 'blue PHANTOM'],
    };
    const extraImage = await grant('catalog');
    form.images = [{ objectKey: extraImage.objectKey, url: extraImage.url, position: 0 }];
    current.items[0].data.material = form;
    const linkedForm = importMaterialDraft(current.items[1].data);
    linkedForm.values.aliases = ['原有叫法', '补充叫法'];
    current.items[1].data.material = linkedForm;
    current = await saveImageImport(current.id, draft(current));
    expect(current.items[0].data.material?.values.notes).toBe('完整表单备注');
    expect((await getImageImport(current.id)).items[0].data.material?.values.aliases).toEqual([
      '蓝色千层',
      'Blue phantom',
    ]);
    expect(
      (await db.uploadGrant.findUniqueOrThrow({ where: { objectKey: extraImage.objectKey } }))
        .usedAt,
    ).not.toBeNull();
    await db.uploadGrant.update({
      where: { objectKey: extraImage.objectKey },
      data: { expiresAt: new Date(0) },
    });
    current = await saveImageImport(current.id, draft(current));
    expect(await db.material.count({ where: { name: `${prefix}-new` } })).toBe(0);
    expect(await db.materialBatch.count({ where: { name: `${prefix}-batch` } })).toBe(0);
    const crop = await grant();
    const firstRequest = {
      version: current.version,
      itemId: current.items[0].id,
      imageKey: crop.objectKey,
    };
    current = await commitImageImportItem(current.id, firstRequest);
    const first = current.items.find((row) => row.id === firstRequest.itemId)!;
    expect(first.entryId).toBeTruthy();
    const entry = await db.materialBatchEntry.findUniqueOrThrow({ where: { id: first.entryId! } });
    expect(entry.remainingQty?.toString()).toBe('3');
    expect(entry.purchaseUnitPrice?.toString()).toBe('4.5');
    expect(entry.saleRule).toBe('PERCENT_60');
    expect(entry.saleUnitPrice?.toString()).toBe('8');
    expect(entry.lengthMm?.toString()).toBe('12.5');
    expect((await db.material.findUniqueOrThrow({ where: { id: first.materialId! } })).notes).toBe(
      '完整表单备注',
    );
    expect(await db.materialBatchImage.count({ where: { entryId: entry.id } })).toBe(2);
    const savedImage = await db.materialBatchImage.findFirstOrThrow({
      where: { entryId: entry.id },
      orderBy: { position: 'asc' },
    });
    expect(savedImage.objectKey).toBe(crop.objectKey);
    expect(savedImage.url).toBe(crop.url);
    expect(current.settings.selection).toEqual({ batchId: entry.batchId });
    const retried = await commitImageImportItem(current.id, firstRequest);
    expect(retried.version).toBe(current.version);
    expect(await db.material.count({ where: { name: `${prefix}-new` } })).toBe(1);
    const badSettings = draft(current);
    badSettings.settings = { ...badSettings.settings, distributorId: '' };
    await expect(saveImageImport(current.id, badSettings)).rejects.toThrow(
      'IMPORT_ALREADY_COMMITTED',
    );
    const modified = draft(current);
    modified.items[0] = {
      ...modified.items[0],
      data: { ...modified.items[0].data, quantity: 100 },
    };
    await expect(saveImageImport(current.id, modified)).rejects.toThrow('IMPORT_ALREADY_COMMITTED');
    const pending = current.items.find((row) => !row.entryId)!;
    const secondCrop = await grant();
    current = await commitImageImportItem(current.id, {
      version: current.version,
      itemId: pending.id,
      imageKey: secondCrop.objectKey,
    });
    const secondEntry = await db.materialBatchEntry.findUniqueOrThrow({
      where: { id: current.items.find((row) => row.id === pending.id)!.entryId! },
    });
    expect(
      (await db.material.findUniqueOrThrow({ where: { id: first.materialId! } })).aliases,
    ).toEqual(['蓝色千层', 'Blue phantom']);
    expect((await db.material.findUniqueOrThrow({ where: { id: existing.id } })).aliases).toEqual([
      '原有叫法',
      '补充叫法',
    ]);
    expect(secondEntry.materialId).toBe(existing.id);
    expect(secondEntry.batchId).toBe(entry.batchId);
    expect(secondEntry.purchaseUnitPrice?.toString()).toBe('6');
    expect(secondEntry.saleUnitPrice?.toString()).toBe('9');
    expect(await db.materialBatchAttachment.count({ where: { objectKey: sourceKey } })).toBe(1);
    const attachments = await db.materialBatchAttachment.findMany({
      where: { objectKey: sourceKey },
    });
    expect(
      materialBatchWriteSchema.safeParse({
        name: `${prefix}-batch`,
        receivedAt: '2026-10-21',
        notes: '',
        attachments: attachments.map(({ objectKey, fileName, notes }) => ({
          objectKey,
          fileName,
          notes,
        })),
      }).success,
    ).toBe(true);
    await expect(
      recognizeImageImport(current.id, { version: current.version, provider: 'deepseek' }),
    ).rejects.toThrow('IMPORT_CONFLICT');
    const sourceMaterial = serializeMaterial(
      await db.material.findUniqueOrThrow({
        where: { id: first.materialId! },
        include: materialInclude,
      }),
    );
    expect(sourceMaterial.imageImportCount).toBe(1);
    expect(await materialImageImportSources(first.materialId!)).toMatchObject([
      {
        importId: current.id,
        itemId: first.id,
        entryId: entry.id,
        fileName: 'supplier.png',
        sourceUrl: current.sourceUrl,
        archivedAt: null,
        batch: { id: entry.batchId },
        distributor: { id: distributorId },
      },
    ]);
    // Archiving committed history preserves both receipts and the stock-to-image source chain.
    materials.push(...current.items.flatMap((row) => (row.materialId ? [row.materialId] : [])));
    await deleteImageImport(current.id, current.version);
    expect(await db.materialImageImportItem.count({ where: { importId: current.id } })).toBe(2);
    const archived = await getImageImport(current.id);
    expect(archived.archivedAt).toBeTruthy();
    expect(await materialImageImportSources(first.materialId!)).toMatchObject([
      {
        importId: current.id,
        archivedAt: archived.archivedAt,
        sourceUrl: current.sourceUrl,
      },
    ]);
    await expect(saveImageImport(current.id, draft(archived))).rejects.toThrow('IMPORT_CONFLICT');
    await expect(
      recognizeImageImport(current.id, { version: archived.version, provider: 'deepseek' }),
    ).rejects.toThrow('IMPORT_CONFLICT');
    expect(await db.material.findUnique({ where: { id: first.materialId! } })).not.toBeNull();
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: entry.id } })
      ).remainingQty?.toString(),
    ).toBe('3');
    expect(
      await db.materialBatchEntry.findUnique({ where: { id: secondEntry.id } }),
    ).not.toBeNull();
    expect(await db.materialBatchImage.count({ where: { entryId: entry.id } })).toBe(2);
    expect(await db.materialBatchAttachment.count({ where: { objectKey: sourceKey } })).toBe(1);

    let restock = await job();
    restock.settings = {
      distributorId,
      priceKind: 'PURCHASE',
      selection: { newBatch: { name: `${prefix}-restock`, receivedAt: '2026-10-26', notes: '' } },
    };
    restock.items = [
      {
        id: crypto.randomUUID(),
        materialId: null,
        entryId: null,
        data: { ...first.data, material: undefined, existingMaterialId: first.materialId },
      },
    ];
    restock = await saveImageImport(restock.id, draft(restock));
    const restockCrop = await grant();
    restock = await commitImageImportItem(restock.id, {
      version: restock.version,
      itemId: restock.items[0].id,
      imageKey: restockCrop.objectKey,
    });
    const sources = await materialImageImportSources(first.materialId!);
    expect(sources.map((source) => source.importId)).toEqual([restock.id, current.id]);
    expect(sources[0].sourceUrl).toBe(restock.sourceUrl);
    expect(sources[1].sourceUrl).toBe(current.sourceUrl);
    expect(
      serializeMaterial(
        await db.material.findUniqueOrThrow({
          where: { id: first.materialId! },
          include: materialInclude,
        }),
      ).imageImportCount,
    ).toBe(2);
  });

  it('rejects stale or actively processing deletions and allows deleting expired runs with candidates', async () => {
    let current = await job();
    current.items = [
      {
        id: crypto.randomUUID(),
        materialId: null,
        entryId: null,
        data: newImportItem('PURCHASE'),
      },
    ];
    const staleVersion = current.version;
    current = await saveImageImport(current.id, draft(current));
    await expect(deleteImageImport(current.id, staleVersion)).rejects.toThrow('IMPORT_CONFLICT');
    await db.materialImageImport.update({
      where: { id: current.id },
      data: {
        status: 'PROCESSING',
        runToken: 'running',
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    await expect(deleteImageImport(current.id, current.version)).rejects.toThrow('IMPORT_CONFLICT');
    expect((await getImageImport(current.id)).items).toHaveLength(1);
    await db.materialImageImport.update({
      where: { id: current.id },
      data: { leaseUntil: new Date(0) },
    });
    await deleteImageImport(current.id, current.version);
    await expect(getImageImport(current.id)).rejects.toThrow('NOT_FOUND');
    expect(await db.materialImageImportItem.count({ where: { importId: current.id } })).toBe(0);
    await expect(deleteImageImport(current.id, current.version)).rejects.toThrow('NOT_FOUND');
  });

  it('archives a partially committed import and blocks writes to its remaining candidates', async () => {
    let current = await job();
    current.settings = {
      distributorId,
      priceKind: 'PURCHASE',
      selection: { newBatch: { name: `${prefix}-partial`, receivedAt: '2026-10-26', notes: '' } },
    };
    current.items = [0, 1].map((index) => ({
      id: crypto.randomUUID(),
      materialId: null,
      entryId: null,
      data: {
        ...newImportItem('PURCHASE'),
        name: `${prefix}-partial-${index}`,
        categoryId,
        price: '5.00',
        reviewed: true,
      },
    }));
    current = await saveImageImport(current.id, draft(current));
    const crop = await grant();
    current = await commitImageImportItem(current.id, {
      version: current.version,
      itemId: current.items[0].id,
      imageKey: crop.objectKey,
    });
    const materialId = current.items[0].materialId!;
    materials.push(materialId);
    const pending = current.items[1].id;
    await deleteImageImport(current.id, current.version);
    current = await getImageImport(current.id);
    expect(current.archivedAt).toBeTruthy();
    expect(current.items).toHaveLength(2);
    const pendingCrop = await grant();
    await expect(
      commitImageImportItem(current.id, {
        version: current.version,
        itemId: pending,
        imageKey: pendingCrop.objectKey,
      }),
    ).rejects.toThrow('IMPORT_CONFLICT');
    expect(await db.material.count({ where: { name: `${prefix}-partial-1` } })).toBe(0);
    expect((await materialImageImportSources(materialId))[0].archivedAt).toBe(current.archivedAt);
  });

  it('preserves edits on model failure, recovers an expired run, rejects stale drafts and rolls back invalid stock entry', async () => {
    let current = await job('catalog');
    current.items = [
      {
        id: crypto.randomUUID(),
        materialId: null,
        entryId: null,
        data: {
          ...newImportItem('PURCHASE'),
          name: `${prefix}-recovery`,
          categoryId,
          quantity: null,
          price: '10',
          reviewed: true,
        },
      },
    ];
    current.settings = {
      distributorId,
      priceKind: 'PURCHASE',
      selection: {
        newBatch: { name: `${prefix}-recovery-batch`, receivedAt: '2026-10-21', notes: '' },
      },
    };
    const stale = draft(current);
    current = await saveImageImport(current.id, draft(current));
    await expect(saveImageImport(current.id, stale)).rejects.toThrow('IMPORT_CONFLICT');
    mocks.recognize.mockRejectedValueOnce(new ApiError(502, 'IMPORT_MODEL_UNAVAILABLE'));
    await expect(
      recognizeImageImport(current.id, { version: current.version, provider: 'deepseek' }),
    ).rejects.toThrow('IMPORT_MODEL_UNAVAILABLE');
    current = await getImageImport(current.id);
    expect(current.status).toBe('FAILED');
    expect(current.items[0].data.name).toBe(`${prefix}-recovery`);
    const crop = await grant();
    await expect(
      commitImageImportItem(current.id, {
        version: current.version,
        itemId: current.items[0].id,
        imageKey: crop.objectKey,
      }),
    ).rejects.toThrow('IMPORT_INCOMPLETE');
    expect((await getImageImport(current.id)).version).toBe(current.version);
    expect(await db.materialBatch.count({ where: { name: `${prefix}-recovery-batch` } })).toBe(0);
    await db.materialImageImport.update({
      where: { id: current.id },
      data: { status: 'PROCESSING', runToken: 'abandoned', leaseUntil: new Date(0) },
    });
    current = await saveImageImport(current.id, draft(current));
    expect(current.status).toBe('READY');
    await db.materialImageImport.update({
      where: { id: current.id },
      data: { status: 'PROCESSING', runToken: 'abandoned-again', leaseUntil: new Date(0) },
    });
    mocks.recognize.mockResolvedValueOnce({
      model: 'fixture',
      warnings: [],
      items: [{ ...current.items[0].data, quantity: 2 }],
    });
    current = await recognizeImageImport(current.id, {
      version: current.version,
      provider: 'deepseek',
    });
    await db.uploadGrant.update({ where: { id: crop.id }, data: { expiresAt: new Date(0) } });
    await expect(
      commitImageImportItem(current.id, {
        version: current.version,
        itemId: current.items[0].id,
        imageKey: crop.objectKey,
      }),
    ).rejects.toThrow('INVALID_IMAGE');
    expect(await db.material.count({ where: { name: `${prefix}-recovery` } })).toBe(0);
    expect(await db.materialBatch.count({ where: { name: `${prefix}-recovery-batch` } })).toBe(0);
    const freshCrop = await grant();
    const request = {
      version: current.version,
      itemId: current.items[0].id,
      imageKey: freshCrop.objectKey,
    };
    const outcomes = await Promise.allSettled([
      commitImageImportItem(current.id, request),
      commitImageImportItem(current.id, request),
    ]);
    expect(outcomes.some((row) => row.status === 'fulfilled')).toBe(true);
    const receipt = await commitImageImportItem(current.id, request);
    expect(receipt.items[0].entryId).toBeTruthy();
    expect(await db.material.count({ where: { name: `${prefix}-recovery` } })).toBe(1);
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: receipt.items[0].entryId! } })
      ).remainingQty?.toString(),
    ).toBe('2');
  });
});
