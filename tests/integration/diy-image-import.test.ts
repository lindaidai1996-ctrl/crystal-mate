import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
const mocks = vi.hoisted(() => ({ detect: vi.fn(), match: vi.fn() }));
vi.mock('@/lib/diyImageImport/vision', async (original) => ({
  ...(await original<typeof import('@/lib/diyImageImport/vision')>()),
  detectDiyParts: mocks.detect,
}));
vi.mock('@/lib/diyImageImport/matching', () => ({ matchDiyParts: mocks.match }));
vi.mock('@/lib/materialImageImport/sourceImage', () => ({
  readImportSource: vi
    .fn()
    .mockResolvedValue({ bytes: Buffer.from('fixture'), mimeType: 'image/png' }),
}));
import { db } from '@/lib/db';
import {
  createDiyImport,
  deleteDiyImport,
  getDiyImport,
  recognizeDiyImport,
  saveDiyImport,
} from '@/lib/diyImageImport/store';
import { commitDiyImport } from '@/lib/diyImageImport/commit';
import { newDiyPart, type DiyImport } from '@/lib/diyImageImport/contracts';

const enabled =
  !!process.env.INTEGRATION_DATABASE_URL &&
  new URL(process.env.DATABASE_URL!).pathname.endsWith('_test');
const jobs: string[] = [];
const grants: string[] = [];
const products: string[] = [];
let categoryId: string;
let materialCategoryId: string;
let distributorId: string;
let batchId: string;
let materialId: string;
let entryId: string;
const suffix = crypto.randomUUID();
async function draft(targetProductId?: string) {
  const objectKey = `material-imports/sources/${crypto.randomUUID()}.png`;
  grants.push(objectKey);
  await db.uploadGrant.create({
    data: {
      objectKey,
      url: `/api/images/${objectKey}`,
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const job = await createDiyImport({
    id: crypto.randomUUID(),
    images: [
      {
        id: crypto.randomUUID(),
        objectKey,
        url: 'https://untrusted.invalid/fake',
        fileName: 'product.png',
        width: 800,
        height: 600,
      },
    ],
    targetProductId: targetProductId ?? null,
  });
  jobs.push(job.id);
  return job;
}
async function ready(job: DiyImport) {
  return saveDiyImport(job.id, {
    version: job.version,
    images: job.images,
    data: {
      ...job.data,
      name: 'AI DIY 测试',
      categoryId,
      code: `DIY-${crypto.randomUUID()}`,
      salePrice: '100',
      quantity: 3,
      parts: [
        {
          ...newDiyPart(),
          name: '白水晶',
          materialId,
          materialBatchEntryId: entryId,
          quantity: '12',
          unitCost: '1.25',
          reviewed: true,
          views: [{ imageId: job.images[0].id, box: { x: 100, y: 100, width: 200, height: 200 } }],
        },
      ],
    },
  });
}
beforeAll(async () => {
  if (!enabled) return;
  categoryId = (await db.category.create({ data: { name: `DIY 成品-${suffix}` } })).id;
  materialCategoryId = (await db.materialCategory.create({ data: { name: `DIY 物料-${suffix}` } }))
    .id;
  distributorId = (
    await db.distributor.create({ data: { name: `DIY 测试-${suffix}`, area: '测试' } })
  ).id;
  batchId = (
    await db.materialBatch.create({ data: { name: `DIY 批次-${suffix}`, receivedAt: new Date() } })
  ).id;
  materialId = (
    await db.material.create({
      data: { name: `白水晶-${suffix}`, categoryId: materialCategoryId, unit: 'BEAD' },
    })
  ).id;
  entryId = (
    await db.materialBatchEntry.create({
      data: {
        materialId,
        batchId,
        distributorId,
        receivedQty: 100,
        remainingQty: 100,
        purchaseUnitPrice: '1.25',
      },
    })
  ).id;
  process.env.IMPORT_VISION_BASE_URL = 'https://vision.example/v1';
  process.env.IMPORT_VISION_MODEL = 'fixture';
  process.env.IMPORT_VISION_API_KEY = 'fixture';
});
afterAll(async () => {
  if (enabled) {
    await db.diyImageImport.deleteMany({ where: { id: { in: jobs } } });
    await db.productDiyRun.deleteMany({ where: { productId: { in: products } } });
    await db.productCode.deleteMany({ where: { productId: { in: products } } });
    await db.product.deleteMany({ where: { id: { in: products } } });
    await db.materialBatchEntry.deleteMany({ where: { id: entryId } });
    await db.material.deleteMany({ where: { id: materialId } });
    await db.materialBatch.deleteMany({ where: { id: batchId } });
    await db.distributor.deleteMany({ where: { id: distributorId } });
    await db.materialCategory.deleteMany({ where: { id: materialCategoryId } });
    await db.category.deleteMany({ where: { id: categoryId } });
    await db.uploadGrant.deleteMany({ where: { objectKey: { in: grants } } });
  }
  await db.$disconnect();
});
describe.skipIf(!enabled)('DIY reviewed inventory transactions', () => {
  it('claims uploaded photos once and restores the authoritative storage URL', async () => {
    const job = await draft();
    expect(job.images[0].url).toBe(`/api/images/${job.images[0].objectKey}`);
    await expect(
      createDiyImport({ id: crypto.randomUUID(), images: job.images, targetProductId: null }),
    ).rejects.toThrow('INVALID_IMAGE');
    expect((await getDiyImport(job.id)).data).toEqual(job.data);
    await expect(commitDiyImport(job.id, job.version)).rejects.toThrow('DIY_INCOMPLETE');
  });
  it('rejects stale writes and leaves stock untouched until the complete draft commits', async () => {
    const initial = await draft();
    const job = await ready(initial);
    await expect(
      saveDiyImport(job.id, { version: initial.version, images: job.images, data: job.data }),
    ).rejects.toThrow('DIY_CONFLICT');
    await expect(commitDiyImport(job.id, initial.version)).rejects.toThrow('DIY_CONFLICT');
    expect(await db.product.count({ where: { code: job.data.code } })).toBe(0);
    const received = await commitDiyImport(job.id, job.version);
    products.push(received.productId!);
    const product = await db.product.findUniqueOrThrow({
      where: { id: received.productId! },
      include: { diyRuns: true, images: true },
    });
    expect(product).toMatchObject({ stock: 3, origin: 'DIY', published: false });
    expect(product.images[0].objectKey).toBe(job.images[0].objectKey);
    expect(product.diyRuns[0].perUnitCost.toFixed(2)).toBe('15.00');
    expect(product.diyRuns[0].totalCost!.toFixed(2)).toBe('45.00');
    expect(
      (
        await db.materialBatchEntry.findUniqueOrThrow({ where: { id: entryId } })
      ).remainingQty!.toNumber(),
    ).toBe(100);
    expect(await commitDiyImport(job.id, job.version)).toMatchObject({
      productId: received.productId,
      runId: received.runId,
    });
    await expect(deleteDiyImport(job.id, received.version)).rejects.toThrow(
      'DIY_ALREADY_COMMITTED',
    );
  });
  it('commits simultaneous submissions only once', async () => {
    const job = await ready(await draft());
    const receipts = await Promise.all([
      commitDiyImport(job.id, job.version),
      commitDiyImport(job.id, job.version),
    ]);
    products.push(receipts[0].productId!);
    expect(receipts[0].runId).toBe(receipts[1].runId);
    const product = await db.product.findUniqueOrThrow({
      where: { id: receipts[0].productId! },
      include: { diyRuns: true },
    });
    expect(product.stock).toBe(3);
    expect(product.diyRuns).toHaveLength(1);
  });
  it('rolls back the receipt and product when a selected batch no longer exists or belongs elsewhere', async () => {
    const job = await ready(await draft());
    const data = {
      ...job.data,
      parts: job.data.parts.map((part) => ({ ...part, materialId: 'clx1234567890123456789012' })),
    };
    const saved = await saveDiyImport(job.id, { version: job.version, images: job.images, data });
    await expect(commitDiyImport(job.id, saved.version)).rejects.toThrow(
      'MATERIAL_ENTRY_NOT_FOUND',
    );
    expect((await getDiyImport(job.id)).status).toBe('DRAFT');
    expect(await db.product.count({ where: { code: job.data.code } })).toBe(0);
    expect((await getDiyImport(job.id)).version).toBe(saved.version);
  });
  it('adds a run to an existing DIY product without changing its sale or publishing fields', async () => {
    const product = await db.product.create({
      data: {
        code: `DIY-existing-${suffix}`,
        name: '已有商品',
        categoryId,
        origin: 'DIY',
        priceCents: 9900,
        stock: 2,
        published: true,
      },
    });
    products.push(product.id);
    const job = await ready(await draft(product.id));
    const receipt = await commitDiyImport(job.id, job.version);
    expect(receipt.productId).toBe(product.id);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({
      stock: 5,
      priceCents: 9900,
      published: true,
      name: '已有商品',
    });
  });
  it('preserves the draft after recognition fails and accepts a later successful retry', async () => {
    const job = await ready(await draft());
    mocks.detect.mockRejectedValueOnce(new Error('offline'));
    await expect(
      recognizeDiyImport(job.id, { version: job.version, provider: 'compatible' }),
    ).rejects.toThrow('offline');
    const failed = await getDiyImport(job.id);
    expect(failed.status).toBe('DRAFT');
    expect(failed.data.parts).toEqual(job.data.parts);
    const fresh = {
      ...newDiyPart(),
      name: '扣头',
      searchTerms: ['扣头'],
      views: [{ imageId: job.images[0].id, box: { x: 700, y: 700, width: 100, height: 100 } }],
    };
    mocks.detect.mockResolvedValueOnce({ parts: [fresh], warnings: [], model: 'fixture' });
    mocks.match.mockResolvedValueOnce({ parts: [fresh], warnings: [] });
    const retried = await recognizeDiyImport(job.id, {
      version: failed.version,
      provider: 'compatible',
    });
    expect(retried.data.parts).toHaveLength(2);
    expect(retried.data.parts[0]).toEqual(job.data.parts[0]);
    expect(retried.errorCode).toBeNull();
    await expect(
      recognizeDiyImport(job.id, {
        version: retried.version,
        provider: 'compatible',
        partId: retried.data.parts[0].id,
      }),
    ).rejects.toThrow('DIY_PART_NOT_EDITABLE');
  });
  it('blocks edits during a live lease and prevents a late model response from overwriting recovered edits', async () => {
    const job = await ready(await draft());
    let release!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.detect.mockImplementationOnce(async () => {
      signalStarted();
      await deferred;
      return { parts: [], warnings: [], model: 'fixture' };
    });
    mocks.match.mockResolvedValueOnce({ parts: [], warnings: [] });
    const outcome = recognizeDiyImport(job.id, {
      version: job.version,
      provider: 'compatible',
    }).then(
      (result) => result,
      (error: Error) => error,
    );
    await started;
    const running = await getDiyImport(job.id);
    expect(running.status).toBe('PROCESSING');
    await expect(
      saveDiyImport(job.id, {
        version: running.version,
        images: running.images,
        data: running.data,
      }),
    ).rejects.toThrow('DIY_CONFLICT');
    await db.diyImageImport.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
    const recovered = await saveDiyImport(job.id, {
      version: running.version,
      images: running.images,
      data: { ...running.data, notes: '人工恢复后的新备注' },
    });
    release();
    expect(await outcome).toMatchObject({ message: 'DIY_CONFLICT' });
    const latest = await getDiyImport(job.id);
    expect(latest.version).toBe(recovered.version);
    expect(latest.data.notes).toBe('人工恢复后的新备注');
    expect(latest.status).toBe('DRAFT');
  });
});
