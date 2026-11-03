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
import { db } from '@/lib/db';
import { getAttachmentCandidates } from '@/lib/attachment-candidates';
import { createBatch, updateBatch } from '@/lib/material-batches';
import { createDistributor, updateDistributor } from '@/lib/distributors';
import type { AttachmentCandidate } from '@/lib/attachments';
import { materialBatchWriteSchema } from '@/lib/validation';

const databaseName = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).pathname.slice(1)
  : '';
const enabled = process.env.INTEGRATION_DATABASE_URL && databaseName.endsWith('_test');
const prefix = `attachment-test-${crypto.randomUUID()}`;
const queries = { q: '', type: 'all' as const, page: 1, pageSize: 20 };
let categoryId: string;
let materialCategoryId: string;
const grantKeys: string[] = [];

function photo(position = 0) {
  const objectKey = `images/${crypto.randomUUID()}.png`;
  return { objectKey, url: `/uploads/${objectKey}`, position };
}
function asAttachment(item: AttachmentCandidate) {
  return {
    objectKey: item.objectKey,
    fileName: item.fileName,
    source: item.source,
    notes: 'saved snapshot',
  };
}
const distributorHeader = (name: string) => ({
  name,
  area: prefix,
  address: '',
  wechat: '',
  phone: '',
  notes: '',
});
const batchHeader = (name: string) => ({ name, receivedAt: '2026-11-03', notes: '' });
async function uploaded() {
  const image = photo();
  grantKeys.push(image.objectKey);
  await db.uploadGrant.create({
    data: {
      objectKey: image.objectKey,
      url: image.url,
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  return { objectKey: image.objectKey, fileName: 'receipt.png', notes: '' };
}

async function fixture() {
  const suffix = `${prefix}-${crypto.randomUUID()}`;
  const a = await createDistributor(distributorHeader(`${suffix}-a`));
  const b = await createDistributor(distributorHeader(`${suffix}-b`));
  const batches = await Promise.all(
    [1, 2, 3].map((day) =>
      db.materialBatch.create({
        data: {
          name: `${suffix}-${day}`,
          receivedAt: new Date(`2026-11-0${day}T00:00:00Z`),
        },
      }),
    ),
  );
  const material = await db.material.create({
    data: {
      name: `${suffix}-material`,
      aliases: ['青玉别名'],
      categoryId: materialCategoryId,
      images: { create: [photo(0), photo(1)] },
      batchEntries: {
        create: batches.map((batch, index) => ({
          batchId: batch.id,
          distributorId: index === 2 ? b.id : a.id,
          receivedQty: 1,
          remainingQty: 1,
          images: { create: [photo(0), photo(1)] },
        })),
      },
    },
    include: {
      images: { orderBy: { position: 'asc' } },
      batchEntries: { include: { images: { orderBy: { position: 'asc' } } } },
    },
  });
  const fallback = await db.material.create({
    data: {
      name: `${suffix}-fallback`,
      categoryId: materialCategoryId,
      images: { create: [photo(0), photo(1)] },
      batchEntries: {
        create: [
          {
            batchId: batches[0].id,
            distributorId: a.id,
            receivedQty: 1,
            remainingQty: 1,
            images: { create: [photo()] },
          },
          { batchId: batches[1].id, distributorId: a.id, receivedQty: 1, remainingQty: 1 },
        ],
      },
    },
    include: { images: { orderBy: { position: 'asc' } } },
  });
  await db.material.create({
    data: {
      name: `${suffix}-no-image`,
      categoryId: materialCategoryId,
      batchEntries: {
        create: { batchId: batches[1].id, distributorId: a.id, receivedQty: 1, remainingQty: 1 },
      },
    },
  });
  const product = await db.product.create({
    data: {
      name: `${suffix}-product`,
      code: suffix,
      aliases: ['成品别名'],
      categoryId,
      priceCents: 100,
      images: { create: [photo(0), photo(1)] },
      purchaseEntries: {
        create: [
          ...batches.map((batch, index) => ({
            batchId: batch.id,
            distributorId: index === 2 ? b.id : a.id,
            quantity: 1,
            unitCost: '1',
          })),
          { batchId: batches[1].id, distributorId: a.id, quantity: 2, unitCost: '1' },
        ],
      },
    },
    include: { images: { orderBy: { position: 'asc' } } },
  });
  return { a, b, batches, material, fallback, product };
}

describe.skipIf(!enabled)('attachment candidates and saves', () => {
  beforeAll(async () => {
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
    materialCategoryId = (await db.materialCategory.create({ data: { name: prefix } })).id;
  });
  afterAll(async () => {
    await db.productPurchaseEntry.deleteMany({ where: { product: { categoryId } } });
    await db.product.deleteMany({ where: { categoryId } });
    await db.materialBatchEntry.deleteMany({
      where: { material: { categoryId: materialCategoryId } },
    });
    await db.material.deleteMany({ where: { categoryId: materialCategoryId } });
    await db.materialBatch.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.distributor.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.distributorArea.deleteMany({ where: { name: prefix } });
    await db.uploadGrant.deleteMany({ where: { objectKey: { in: grantKeys } } });
    await db.category.delete({ where: { id: categoryId } });
    await db.materialCategory.delete({ where: { id: materialCategoryId } });
    await db.$disconnect();
  });

  it('chooses first images within the owner, deduplicates purchases, searches and paginates', async () => {
    const f = await fixture();
    const page = await getAttachmentCandidates({ type: 'distributor', id: f.a.id }, queries);
    expect(page.total).toBe(3);
    expect(page.items.find((item) => item.itemId === f.material.id)?.objectKey).toBe(
      f.material.batchEntries.find((entry) => entry.batchId === f.batches[1].id)!.images[0]
        .objectKey,
    );
    expect(page.items.find((item) => item.itemId === f.fallback.id)?.objectKey).toBe(
      f.fallback.images[0].objectKey,
    );
    expect(page.items.find((item) => item.itemId === f.product.id)?.objectKey).toBe(
      f.product.images[0].objectKey,
    );
    const old = await getAttachmentCandidates({ type: 'batch', id: f.batches[0].id }, queries);
    expect(old.items.find((item) => item.itemId === f.material.id)?.objectKey).toBe(
      f.material.batchEntries.find((entry) => entry.batchId === f.batches[0].id)!.images[0]
        .objectKey,
    );
    const newer = await getAttachmentCandidates({ type: 'distributor', id: f.b.id }, queries);
    expect(newer.items.find((item) => item.itemId === f.material.id)?.objectKey).toBe(
      f.material.batchEntries.find((entry) => entry.batchId === f.batches[2].id)!.images[0]
        .objectKey,
    );
    expect(
      (
        await getAttachmentCandidates(
          { type: 'distributor', id: f.a.id },
          { ...queries, q: '青玉别名' },
        )
      ).items.map((item) => item.itemId),
    ).toEqual([f.material.id]);
    expect(
      (
        await getAttachmentCandidates(
          { type: 'batch', id: f.batches[1].id },
          { ...queries, type: 'product', q: f.product.code },
        )
      ).items.map((item) => item.itemId),
    ).toEqual([f.product.id]);
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        getAttachmentCandidates(
          { type: 'distributor', id: f.a.id },
          { ...queries, page, pageSize: 1 },
        ),
      ),
    );
    expect(new Set(pages.flatMap((page) => page.items.map((item) => item.itemId))).size).toBe(3);
    expect(
      await getAttachmentCandidates({ type: 'distributor', id: f.a.id }, { ...queries, page: 99 }),
    ).toMatchObject({ total: 3, items: [] });
    expect(
      await getAttachmentCandidates(
        { type: 'distributor', id: f.a.id },
        { ...queries, q: 'missing' },
      ),
    ).toMatchObject({ total: 0, items: [] });
    await expect(
      getAttachmentCandidates({ type: 'batch', id: 'missing' }, queries),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('shares stored images across owners, preserves snapshots, and keeps covers on ordinary saves', async () => {
    const f = await fixture();
    const candidates = (await getAttachmentCandidates({ type: 'distributor', id: f.a.id }, queries))
      .items;
    const attachments = candidates.map(asAttachment);
    const cover = attachments[1].objectKey;
    const distributor = await updateDistributor(f.a.id, {
      ...distributorHeader(f.a.name),
      attachments,
      coverObjectKey: cover,
    });
    expect(distributor.coverObjectKey).toBe(cover);
    expect(distributor.attachments.map((item) => item.objectKey)).toEqual(
      attachments.map((item) => item.objectKey),
    );
    const currentBatch = await updateBatch(f.batches[1].id, {
      ...batchHeader(f.batches[1].name),
      attachments,
      coverObjectKey: cover,
    });
    expect(currentBatch.coverObjectKey).toBe(cover);
    const productAttachment = attachments.find((item) => item.source.kind === 'PRODUCT_IMAGE')!;
    for (const batch of [f.batches[0], f.batches[2]]) {
      await updateBatch(batch.id, { ...batchHeader(batch.name), attachments: [productAttachment] });
    }
    await updateDistributor(f.b.id, {
      ...distributorHeader(f.b.name),
      attachments: [productAttachment],
    });
    expect(
      await db.materialBatchAttachment.count({ where: { objectKey: productAttachment.objectKey } }),
    ).toBe(3);
    expect(
      await db.distributorAttachment.count({ where: { objectKey: productAttachment.objectKey } }),
    ).toBe(2);
    // Source image records can disappear; persisted attachments do not revalidate the source.
    await db.productImage.deleteMany({ where: { productId: f.product.id } });
    await db.materialBatchImage.deleteMany({ where: { entry: { materialId: f.material.id } } });
    await db.materialImage.deleteMany({ where: { materialId: f.fallback.id } });
    const saved = await updateDistributor(f.a.id, { ...distributorHeader(f.a.name), attachments });
    expect(saved.coverObjectKey).toBe(cover);
    expect(saved.attachments.map((item) => item.url)).toEqual(
      distributor.attachments.map((item) => item.url),
    );
    expect(
      (await updateBatch(f.batches[1].id, { ...batchHeader(f.batches[1].name), attachments }))
        .coverObjectKey,
    ).toBe(cover);
    await updateBatch(f.batches[0].id, { ...batchHeader(f.batches[0].name), attachments: [] });
    expect(
      await db.distributorAttachment.count({ where: { objectKey: productAttachment.objectKey } }),
    ).toBe(2);
    const remaining = attachments.filter((item) => item.objectKey !== cover);
    expect(
      (await updateDistributor(f.a.id, { ...distributorHeader(f.a.name), attachments: remaining }))
        .coverObjectKey,
    ).toBe(remaining[0].objectKey);
    expect(
      (await updateBatch(f.batches[1].id, { ...batchHeader(f.batches[1].name), attachments: [] }))
        .coverObjectKey,
    ).toBeNull();
  });

  it('rejects foreign, changed, second-image and duplicate selections atomically', async () => {
    const f = await fixture();
    const candidates = (await getAttachmentCandidates({ type: 'distributor', id: f.a.id }, queries))
      .items;
    const valid = asAttachment(candidates.find((item) => item.itemId === f.material.id)!);
    const batchHeaderValues = batchHeader(f.batches[1].name);
    const saved = await updateBatch(f.batches[1].id, {
      ...batchHeaderValues,
      attachments: [valid],
    });
    const foreign = (
      await getAttachmentCandidates({ type: 'batch', id: f.batches[2].id }, queries)
    ).items.find((item) => item.itemId === f.material.id)!;
    const product = candidates.find((item) => item.itemId === f.product.id)!;
    const second = f.product.images[1];
    const invalids = [
      [asAttachment(foreign)],
      [
        {
          ...asAttachment(product),
          objectKey: second.objectKey,
          source: { kind: 'PRODUCT_IMAGE' as const, id: second.id },
        },
      ],
      [{ ...asAttachment(product), objectKey: photo().objectKey }],
      [valid, valid],
      [
        {
          ...asAttachment(product),
          source: { kind: 'MATERIAL_IMAGE' as const, id: product.source.id },
        },
      ],
    ];
    for (const attachments of invalids) {
      await expect(
        updateBatch(f.batches[1].id, {
          ...batchHeaderValues,
          notes: 'must roll back',
          attachments,
        }),
      ).rejects.toThrow('INVALID_IMAGE');
      expect(
        await db.materialBatch.findUniqueOrThrow({
          where: { id: f.batches[1].id },
          include: { attachments: true },
        }),
      ).toMatchObject({
        notes: '',
        coverObjectKey: valid.objectKey,
        attachments: [{ id: saved.attachments[0].id }],
      });
    }
    await db.productImage.delete({ where: { id: product.source.id } });
    await expect(
      updateBatch(f.batches[1].id, { ...batchHeaderValues, attachments: [asAttachment(product)] }),
    ).rejects.toThrow('INVALID_IMAGE');
    await expect(
      updateBatch(f.batches[1].id, {
        ...batchHeaderValues,
        attachments: [valid],
        coverObjectKey: photo().objectKey,
      }),
    ).rejects.toThrow('INVALID_IMAGE');
  });

  it('retains upload checks, moves a cropped cover, and supports 50 attachments', async () => {
    const first = await uploaded();
    const second = await uploaded();
    const name = `${prefix}-uploaded-${crypto.randomUUID()}`;
    let batch = await createBatch({
      ...batchHeader(name),
      attachments: [first, second],
      coverObjectKey: second.objectKey,
    });
    const cropped = await uploaded();
    batch = await updateBatch(batch.id, {
      ...batchHeader(name),
      attachments: [first, cropped],
      coverObjectKey: cropped.objectKey,
    });
    expect(batch.coverObjectKey).toBe(cropped.objectKey);
    expect(
      (await db.uploadGrant.findUniqueOrThrow({ where: { objectKey: cropped.objectKey } })).usedAt,
    ).not.toBeNull();
    await expect(
      createDistributor({ ...distributorHeader(`${prefix}-reused`), attachments: [cropped] }),
    ).rejects.toThrow('INVALID_IMAGE');
    const expired = await uploaded();
    await db.uploadGrant.update({
      where: { objectKey: expired.objectKey },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      updateBatch(batch.id, { ...batchHeader(name), attachments: [expired] }),
    ).rejects.toThrow('INVALID_IMAGE');
    const notUploaded = await uploaded();
    await db.uploadGrant.update({
      where: { objectKey: notUploaded.objectKey },
      data: { uploadedAt: null },
    });
    await expect(
      updateBatch(batch.id, { ...batchHeader(name), attachments: [notUploaded] }),
    ).rejects.toThrow('INVALID_IMAGE');
    const fifty = await Promise.all(Array.from({ length: 50 }, uploaded));
    const input = materialBatchWriteSchema.parse({
      ...batchHeader(name),
      attachments: fifty,
      coverObjectKey: fifty[49].objectKey,
    });
    batch = await updateBatch(batch.id, input);
    expect(batch.attachments).toHaveLength(50);
    expect(batch.coverObjectKey).toBe(fifty[49].objectKey);
    expect(
      materialBatchWriteSchema.safeParse({ ...input, attachments: [...fifty, first] }).success,
    ).toBe(false);
    await expect(
      updateBatch(batch.id, { ...input, attachments: [...fifty, first] }),
    ).rejects.toThrow('INVALID_IMAGE');
    expect(await db.materialBatchAttachment.count({ where: { batchId: batch.id } })).toBe(50);
  });
});
