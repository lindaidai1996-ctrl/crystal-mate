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
import { db } from '@/lib/db';
import { createBatch, updateBatch } from '@/lib/material-batches';
import { createDistributor, updateDistributor } from '@/lib/distributors';
import { commandAttachments, attachmentDetails } from '@/lib/shared-attachments';
import { attachmentWriteFields } from '@/lib/attachments';
import { searchAttachmentTargets } from '@/lib/attachment-targets';
const name = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : '';
const enabled = !!process.env.INTEGRATION_DATABASE_URL && name.endsWith('_test');
const prefix = `shared-attachment-${crypto.randomUUID()}`;
const assetIds = new Set<string>();
const keys: string[] = [];
const header = (suffix: string) => ({
  name: `${prefix}-${suffix}`,
  receivedAt: '2026-11-19',
  notes: '',
});
const distributorHeader = (suffix: string) => ({
  name: `${prefix}-${suffix}`,
  area: prefix,
  address: '',
  phone: '',
  wechat: '',
  notes: '',
});
async function uploaded(notes = 'original') {
  const objectKey = `images/${crypto.randomUUID()}.png`;
  keys.push(objectKey);
  await db.uploadGrant.create({
    data: {
      objectKey,
      url: `/uploads/${objectKey}`,
      uploadedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  return { objectKey, fileName: 'receipt.png', notes };
}
async function batch(suffix: string, photos: Awaited<ReturnType<typeof uploaded>>[] = []) {
  const row = await createBatch({ ...header(suffix), attachments: photos });
  row.attachments.forEach((a) => assetIds.add(a.assetId));
  return row;
}
async function supplier(suffix: string) {
  return createDistributor(distributorHeader(suffix));
}
async function ref(id: string) {
  const asset = await attachmentDetails(id);
  return { id, version: asset.version };
}
describe.skipIf(!enabled)('shared attachments, isolated database', () => {
  beforeAll(() => {
    if (!name.endsWith('_test')) throw new Error('Test database required');
  });
  afterAll(async () => {
    await db.distributorAttachment.deleteMany({
      where: { distributor: { name: { startsWith: prefix } } },
    });
    await db.materialBatchAttachment.deleteMany({
      where: { batch: { name: { startsWith: prefix } } },
    });
    await db.materialBatch.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.distributor.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.sharedAttachment.deleteMany({ where: { id: { in: [...assetIds] } } });
    await db.uploadGrant.deleteMany({ where: { objectKey: { in: keys } } });
    await db.distributorArea.deleteMany({ where: { name: prefix } });
    await db.$disconnect();
  });
  it('links in both directions, shares notes, and keeps stable memberships on ordinary saves', async () => {
    const b = await batch('both', [await uploaded()]);
    const d = await supplier('both');
    const id = b.attachments[0].assetId;
    const membership = b.attachments[0].id;
    await commandAttachments({
      operation: 'link',
      assets: [await ref(id)],
      targets: [{ type: 'distributor', id: d.id }],
    });
    const shared = await attachmentDetails(id);
    expect(shared.distributors[0].distributor.id).toBe(d.id);
    await commandAttachments({ operation: 'update', asset: await ref(id), notes: 'shared notes' });
    expect(
      (await db.distributorAttachment.findFirstOrThrow({ where: { assetId: id } })).notes,
    ).toBe('shared notes');
    const current = await db.materialBatch.findUniqueOrThrow({
      where: { id: b.id },
      include: {
        attachments: {
          include: {
            asset: {
              include: {
                distributors: { include: { distributor: true } },
                batches: { include: { batch: true } },
              },
            },
          },
        },
      },
    });
    const saved = await updateBatch(b.id, {
      ...header('both'),
      attachmentsVersion: current.attachmentsVersion,
      attachments: current.attachments.map(attachmentWriteFields),
    });
    expect(saved.attachments[0].id).toBe(membership);
    expect(saved.attachments[0].notes).toBe('shared notes');
    const second = await batch('reverse');
    await commandAttachments({
      operation: 'link',
      assets: [await ref(id)],
      targets: [{ type: 'batch', id: second.id }],
    });
    expect((await attachmentDetails(id)).batches).toHaveLength(2);
  });
  it('rejects stale owner and asset versions without changing metadata', async () => {
    const b = await batch('stale', [await uploaded()]);
    const old = await ref(b.attachments[0].assetId);
    await commandAttachments({ operation: 'update', asset: old, notes: 'new' });
    await expect(
      commandAttachments({ operation: 'update', asset: old, notes: 'stale' }),
    ).rejects.toThrow('ATTACHMENT_CONFLICT');
    await expect(
      updateBatch(b.id, {
        ...header('overwritten'),
        attachmentsVersion: b.attachmentsVersion,
        attachments: b.attachments.map(attachmentWriteFields),
      }),
    ).rejects.toThrow('ATTACHMENT_CONFLICT');
    expect((await db.materialBatch.findUniqueOrThrow({ where: { id: b.id } })).name).toBe(b.name);
  });
  it('serializes competing updates so only one version wins', async () => {
    const b = await batch('race', [await uploaded()]);
    const asset = await ref(b.attachments[0].assetId);
    const results = await Promise.allSettled(
      ['A', 'B'].map((notes) => commandAttachments({ operation: 'update', asset, notes })),
    );
    expect(results.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
  });
  it('replaces the shared image and covers, preserving unrelated covers and source files', async () => {
    const b = await batch('image', [await uploaded(), await uploaded('second')]);
    const d = await supplier('image');
    const id = b.attachments[0].assetId;
    await commandAttachments({
      operation: 'link',
      assets: [await ref(id)],
      targets: [{ type: 'distributor', id: d.id }],
    });
    const replacement = await uploaded();
    await commandAttachments({ operation: 'update', asset: await ref(id), replacement });
    expect((await db.distributor.findUniqueOrThrow({ where: { id: d.id } })).coverObjectKey).toBe(
      replacement.objectKey,
    );
    expect((await db.materialBatch.findUniqueOrThrow({ where: { id: b.id } })).coverObjectKey).toBe(
      replacement.objectKey,
    );
    expect((await attachmentDetails(id)).imageVersion).toBe(2);
    expect(
      (await db.materialBatchAttachment.findFirstOrThrow({ where: { batchId: b.id, position: 1 } }))
        .notes,
    ).toBe('second');
  });
  it('preserves a different destination cover and independent order', async () => {
    const b = await batch('independent', [await uploaded(), await uploaded()]);
    const d = await supplier('independent');
    await commandAttachments({
      operation: 'link',
      assets: await Promise.all(b.attachments.map((a) => ref(a.assetId))),
      targets: [{ type: 'distributor', id: d.id }],
    });
    await db.distributor.update({
      where: { id: d.id },
      data: { coverObjectKey: b.attachments[1].objectKey },
    });
    const replacement = await uploaded();
    await commandAttachments({
      operation: 'update',
      asset: await ref(b.attachments[0].assetId),
      replacement,
    });
    expect((await db.distributor.findUniqueOrThrow({ where: { id: d.id } })).coverObjectKey).toBe(
      b.attachments[1].objectKey,
    );
    const current = await db.materialBatch.findUniqueOrThrow({
      where: { id: b.id },
      include: {
        attachments: {
          include: {
            asset: {
              include: {
                distributors: { include: { distributor: true } },
                batches: { include: { batch: true } },
              },
            },
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    await updateBatch(b.id, {
      ...header('independent'),
      attachmentsVersion: current.attachmentsVersion,
      attachments: [...current.attachments].reverse().map(attachmentWriteFields),
    });
    expect(
      (
        await db.distributorAttachment.findMany({
          where: { distributorId: d.id },
          orderBy: { position: 'asc' },
        })
      ).map((a) => a.assetId),
    ).toEqual(b.attachments.map((a) => a.assetId));
  });
  it('removes only the selected relationship and repairs that cover', async () => {
    const b = await batch('unlink', [await uploaded()]);
    const d = await supplier('unlink');
    const id = b.attachments[0].assetId;
    await commandAttachments({
      operation: 'link',
      assets: [await ref(id)],
      targets: [{ type: 'distributor', id: d.id }],
    });
    await commandAttachments({
      operation: 'unlink',
      assets: [await ref(id)],
      owner: { type: 'batch', id: b.id },
    });
    expect(
      (await db.materialBatch.findUniqueOrThrow({ where: { id: b.id } })).coverObjectKey,
    ).toBeNull();
    expect((await attachmentDetails(id)).distributors).toHaveLength(1);
  });
  it('deletes every link and clears covers without deleting storage objects', async () => {
    const b = await batch('delete', [await uploaded()]);
    const d = await supplier('delete');
    const id = b.attachments[0].assetId;
    await commandAttachments({
      operation: 'link',
      assets: [await ref(id)],
      targets: [{ type: 'distributor', id: d.id }],
    });
    await commandAttachments({ operation: 'delete', assets: [await ref(id)] });
    expect(await db.sharedAttachment.findUnique({ where: { id } })).toBeNull();
    expect(await db.distributorAttachment.count({ where: { assetId: id } })).toBe(0);
    expect(
      (await db.distributor.findUniqueOrThrow({ where: { id: d.id } })).coverObjectKey,
    ).toBeNull();
  });
  it('keeps legacy duplicates separate until explicit merge chooses the shared notes', async () => {
    const b = await batch('merge', [await uploaded('batch notes')]);
    const d = await supplier('merge');
    const original = await attachmentDetails(b.attachments[0].assetId);
    const duplicate = await db.sharedAttachment.create({
      data: {
        objectKey: original.objectKey,
        url: original.url,
        fileName: original.fileName,
        notes: 'supplier notes',
      },
    });
    assetIds.add(duplicate.id);
    await db.distributorAttachment.create({
      data: {
        distributorId: d.id,
        assetId: duplicate.id,
        objectKey: duplicate.objectKey,
        url: duplicate.url,
        fileName: duplicate.fileName,
        notes: duplicate.notes,
        position: 0,
      },
    });
    await expect(
      commandAttachments({
        operation: 'link',
        assets: [await ref(original.id)],
        targets: [{ type: 'distributor', id: d.id }],
      }),
    ).rejects.toThrow('ATTACHMENT_MERGE_REQUIRED');
    await commandAttachments({
      operation: 'merge',
      assets: [await ref(original.id), await ref(duplicate.id)],
      notes: 'supplier notes',
    });
    expect(await db.sharedAttachment.findUnique({ where: { id: duplicate.id } })).toBeNull();
    expect((await attachmentDetails(original.id)).distributors).toHaveLength(1);
    expect(
      (await db.materialBatchAttachment.findFirstOrThrow({ where: { assetId: original.id } }))
        .notes,
    ).toBe('supplier notes');
  });
  it('rolls back all targets if one is full or missing', async () => {
    const b = await batch('rollback', [await uploaded()]);
    const full = await batch(
      'full',
      await Promise.all(Array.from({ length: 50 }, () => uploaded())),
    );
    const empty = await batch('empty');
    const id = b.attachments[0].assetId;
    await expect(
      commandAttachments({
        operation: 'link',
        assets: [await ref(id)],
        targets: [
          { type: 'batch', id: empty.id },
          { type: 'batch', id: full.id },
        ],
      }),
    ).rejects.toThrow('ATTACHMENT_LIMIT');
    expect(await db.materialBatchAttachment.count({ where: { batchId: empty.id } })).toBe(0);
    await expect(
      commandAttachments({
        operation: 'link',
        assets: [await ref(id)],
        targets: [
          { type: 'batch', id: empty.id },
          { type: 'batch', id: 'cmissing00000000000000000' },
        ],
      }),
    ).rejects.toThrow('NOT_FOUND');
    expect(await db.materialBatchAttachment.count({ where: { batchId: empty.id } })).toBe(0);
  });
  it('atomically links different images to their individually confirmed targets', async () => {
    const b = await batch('many', [await uploaded(), await uploaded()]);
    const first = await supplier('many-a');
    const second = await supplier('many-b');
    await commandAttachments({
      operation: 'linkMany',
      items: [
        {
          asset: await ref(b.attachments[0].assetId),
          targets: [{ type: 'distributor', id: first.id }],
        },
        {
          asset: await ref(b.attachments[1].assetId),
          targets: [{ type: 'distributor', id: second.id }],
        },
      ],
    });
    expect((await attachmentDetails(b.attachments[0].assetId)).distributors[0].distributor.id).toBe(
      first.id,
    );
    expect((await attachmentDetails(b.attachments[1].assetId)).distributors[0].distributor.id).toBe(
      second.id,
    );
  });
  it('supports assigning destinations in new forms, rejects reused grants, and searches targets', async () => {
    const d = await supplier('draft');
    const photo = await uploaded();
    const b = await createBatch({
      ...header('draft'),
      attachments: [{ ...photo, targets: [{ type: 'distributor', id: d.id }] }],
    });
    assetIds.add(b.attachments[0].assetId);
    expect((await attachmentDetails(b.attachments[0].assetId)).distributors).toHaveLength(1);
    await expect(createBatch({ ...header('reuse'), attachments: [photo] })).rejects.toThrow(
      'INVALID_IMAGE',
    );
    const targets = await searchAttachmentTargets(
      'distributor',
      { type: 'batch', id: b.id },
      d.name,
    );
    expect(targets.items.map((a) => a.id)).toContain(d.id);
  });
  it('preserves independent order and cover choices while propagating editor changes', async () => {
    const b = await batch('editor', [await uploaded()]);
    const d = await supplier('editor');
    const id = b.attachments[0].assetId;
    await commandAttachments({
      operation: 'link',
      assets: [await ref(id)],
      targets: [{ type: 'distributor', id: d.id }],
    });
    const current = await db.distributor.findUniqueOrThrow({
      where: { id: d.id },
      include: {
        attachments: {
          include: {
            asset: {
              include: {
                distributors: { include: { distributor: true } },
                batches: { include: { batch: true } },
              },
            },
          },
        },
      },
    });
    await updateDistributor(d.id, {
      ...distributorHeader('editor'),
      attachmentsVersion: current.attachmentsVersion,
      attachments: current.attachments.map((a) => ({
        ...attachmentWriteFields(a),
        notes: 'edited from supplier form',
      })),
    });
    expect(
      (await db.materialBatchAttachment.findFirstOrThrow({ where: { batchId: b.id } })).notes,
    ).toBe('edited from supplier form');
  });
});
