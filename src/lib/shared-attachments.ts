import { Prisma, type SharedAttachment } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from './api';
import { db } from './db';
import { MAX_ATTACHMENTS, type AttachmentOwner } from './attachments';
import { assetRefSchema, ownerSchema } from './shared-attachment-contracts';
import { sharedAssetSelect } from './shared-attachment-query';

export type AttachmentTx = Prisma.TransactionClient;
export const lockAttachments = (tx: AttachmentTx) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(719301119)::text`;
const conflict = () => new ApiError(409, 'ATTACHMENT_CONFLICT');
export async function ownerAttachments(tx: AttachmentTx, owner: AttachmentOwner) {
  const item =
    owner.type === 'batch'
      ? await tx.materialBatch.findUnique({
          where: { id: owner.id },
          include: { attachments: { include: { asset: true }, orderBy: { position: 'asc' } } },
        })
      : await tx.distributor.findUnique({
          where: { id: owner.id },
          include: { attachments: { include: { asset: true }, orderBy: { position: 'asc' } } },
        });
  if (!item) throw new ApiError(404, 'NOT_FOUND');
  return item;
}
export async function bumpOwners(tx: AttachmentTx, owners: AttachmentOwner[]) {
  const batches = [...new Set(owners.filter((o) => o.type === 'batch').map((o) => o.id))];
  const distributors = [
    ...new Set(owners.filter((o) => o.type === 'distributor').map((o) => o.id)),
  ];
  if (batches.length)
    await tx.materialBatch.updateMany({
      where: { id: { in: batches } },
      data: { attachmentsVersion: { increment: 1 } },
    });
  if (distributors.length)
    await tx.distributor.updateMany({
      where: { id: { in: distributors } },
      data: { attachmentsVersion: { increment: 1 } },
    });
}
export async function readAsset(tx: AttachmentTx, id: string) {
  const asset = await tx.sharedAttachment.findUnique({
    where: { id },
    include: { distributors: true, batches: true },
  });
  if (!asset || (!asset.distributors.length && !asset.batches.length))
    throw new ApiError(404, 'NOT_FOUND');
  return asset;
}
export async function checkAsset(tx: AttachmentTx, ref: z.infer<typeof assetRefSchema>) {
  const asset = await readAsset(tx, ref.id);
  if (asset.version !== ref.version) throw conflict();
  return asset;
}
export function assetOwners(asset: {
  distributors: { distributorId: string }[];
  batches: { batchId: string }[];
}): AttachmentOwner[] {
  return [
    ...asset.distributors.map((a) => ({ type: 'distributor' as const, id: a.distributorId })),
    ...asset.batches.map((a) => ({ type: 'batch' as const, id: a.batchId })),
  ];
}
export async function repairCover(tx: AttachmentTx, owner: AttachmentOwner) {
  const current = await ownerAttachments(tx, owner);
  const key = current.attachments.some((a) => a.objectKey === current.coverObjectKey)
    ? current.coverObjectKey
    : (current.attachments[0]?.objectKey ?? null);
  if (key !== current.coverObjectKey) {
    if (owner.type === 'batch')
      await tx.materialBatch.update({ where: { id: owner.id }, data: { coverObjectKey: key } });
    else await tx.distributor.update({ where: { id: owner.id }, data: { coverObjectKey: key } });
  }
}
// All callers hold the same transaction lock, including ordinary editor saves.
export async function linkAssets(tx: AttachmentTx, ids: string[], targets: AttachmentOwner[]) {
  const uniqueIds = [...new Set(ids)];
  const sourceRows = await tx.sharedAttachment.findMany({ where: { id: { in: uniqueIds } } });
  if (sourceRows.length !== uniqueIds.length) throw new ApiError(404, 'NOT_FOUND');
  const byId = new Map(sourceRows.map((asset) => [asset.id, asset]));
  const source = uniqueIds.map((id) => byId.get(id)!);
  for (const target of targets) {
    const current = await ownerAttachments(tx, target);
    const additions: SharedAttachment[] = [];
    for (const asset of source) {
      if (current.attachments.some((a) => a.assetId === asset.id)) continue;
      if (
        current.attachments.some((a) => a.objectKey === asset.objectKey) ||
        additions.some((a) => a.objectKey === asset.objectKey)
      )
        throw new ApiError(409, 'ATTACHMENT_MERGE_REQUIRED');
      additions.push(asset);
    }
    if (current.attachments.length + additions.length > MAX_ATTACHMENTS)
      throw new ApiError(409, 'ATTACHMENT_LIMIT');
    const last = Math.max(-1, ...current.attachments.map((a) => a.position));
    for (const [index, asset] of additions.entries()) {
      const data = {
        assetId: asset.id,
        objectKey: asset.objectKey,
        url: asset.url,
        fileName: asset.fileName,
        notes: asset.notes,
        position: last + index + 1,
      };
      if (target.type === 'batch')
        await tx.materialBatchAttachment.create({ data: { ...data, batchId: target.id } });
      else await tx.distributorAttachment.create({ data: { ...data, distributorId: target.id } });
    }
    if (additions.length) {
      await bumpOwners(tx, [target]);
      await repairCover(tx, target);
    }
  }
}
export async function updateSharedAsset(
  tx: AttachmentTx,
  ref: z.infer<typeof assetRefSchema>,
  data: { notes?: string; objectKey?: string; url?: string; fileName?: string },
) {
  const asset = await checkAsset(tx, ref);
  const imageChanged = data.objectKey !== undefined && data.objectKey !== asset.objectKey;
  const owners = assetOwners(asset);
  if (imageChanged) {
    const [distributorCollision, batchCollision] = await Promise.all([
      tx.distributorAttachment.count({
        where: {
          distributorId: { in: asset.distributors.map((a) => a.distributorId) },
          objectKey: data.objectKey,
          assetId: { not: asset.id },
        },
      }),
      tx.materialBatchAttachment.count({
        where: {
          batchId: { in: asset.batches.map((a) => a.batchId) },
          objectKey: data.objectKey,
          assetId: { not: asset.id },
        },
      }),
    ]);
    if (distributorCollision || batchCollision)
      throw new ApiError(409, 'ATTACHMENT_MERGE_REQUIRED');
  }
  await tx.sharedAttachment.update({
    where: { id: asset.id },
    data: {
      ...data,
      version: { increment: 1 },
      ...(imageChanged ? { imageVersion: { increment: 1 } } : {}),
    },
  });
  await tx.distributorAttachment.updateMany({ where: { assetId: asset.id }, data });
  await tx.materialBatchAttachment.updateMany({ where: { assetId: asset.id }, data });
  if (imageChanged) {
    await tx.materialBatch.updateMany({
      where: { id: { in: asset.batches.map((a) => a.batchId) }, coverObjectKey: asset.objectKey },
      data: { coverObjectKey: data.objectKey },
    });
    await tx.distributor.updateMany({
      where: {
        id: { in: asset.distributors.map((a) => a.distributorId) },
        coverObjectKey: asset.objectKey,
      },
      data: { coverObjectKey: data.objectKey },
    });
    await tx.attachmentRecognition.updateMany({
      where: { assetId: asset.id, status: 'running' },
      data: { status: 'cancelled' },
    });
  }
  await bumpOwners(tx, owners);
}
export const attachmentCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('linkMany'),
    items: z
      .array(
        z.strictObject({ asset: assetRefSchema, targets: z.array(ownerSchema).min(1).max(50) }),
      )
      .min(1)
      .max(50),
  }),
  z.strictObject({
    operation: z.literal('link'),
    assets: z.array(assetRefSchema).min(1).max(50),
    targets: z.array(ownerSchema).min(1).max(50),
  }),
  z.strictObject({
    operation: z.literal('unlink'),
    assets: z.array(assetRefSchema).min(1).max(50),
    owner: ownerSchema,
  }),
  z.strictObject({
    operation: z.literal('delete'),
    assets: z.array(assetRefSchema).min(1).max(50),
  }),
  z.strictObject({
    operation: z.literal('merge'),
    assets: z.array(assetRefSchema).min(2).max(50),
    notes: z.string().trim().max(1000),
  }),
  z.strictObject({
    operation: z.literal('update'),
    asset: assetRefSchema,
    notes: z.string().trim().max(1000).optional(),
    replacement: z
      .strictObject({ objectKey: z.string().max(300), fileName: z.string().trim().min(1).max(255) })
      .optional(),
  }),
]);
export async function commandAttachments(input: z.infer<typeof attachmentCommandSchema>) {
  return db.$transaction(
    async (tx) => {
      await lockAttachments(tx);
      const refs =
        input.operation === 'update'
          ? [input.asset]
          : input.operation === 'linkMany'
            ? input.items.map((a) => a.asset)
            : input.assets;
      if (new Set(refs.map((a) => a.id)).size !== refs.length)
        throw new ApiError(400, 'INVALID_INPUT');
      const assets = await Promise.all(refs.map((ref) => checkAsset(tx, ref)));
      if (input.operation === 'update') {
        let replacement: { objectKey: string; url: string; fileName: string } | undefined;
        if (input.replacement) {
          const { imageObjectKeyPattern } = await import('./image-storage');
          if (!imageObjectKeyPattern.test(input.replacement.objectKey))
            throw new ApiError(400, 'INVALID_IMAGE');
          const grant = await tx.uploadGrant.findFirst({
            where: {
              objectKey: input.replacement.objectKey,
              uploadedAt: { not: null },
              usedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          if (!grant) throw new ApiError(400, 'INVALID_IMAGE');
          await tx.uploadGrant.update({ where: { id: grant.id }, data: { usedAt: new Date() } });
          replacement = { ...input.replacement, url: grant.url };
        }
        await updateSharedAsset(tx, input.asset, {
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...replacement,
        });
      } else if (input.operation === 'linkMany') {
        const groups = new Map<string, { target: AttachmentOwner; ids: string[] }>();
        for (const item of input.items)
          for (const target of item.targets) {
            const key = `${target.type}:${target.id}`;
            const group = groups.get(key) ?? { target, ids: [] };
            group.ids.push(item.asset.id);
            groups.set(key, group);
          }
        for (const group of groups.values()) await linkAssets(tx, group.ids, [group.target]);
        for (const asset of assets)
          await tx.sharedAttachment.update({
            where: { id: asset.id },
            data: { version: { increment: 1 } },
          });
        await bumpOwners(tx, assets.flatMap(assetOwners));
      } else if (input.operation === 'link') {
        await linkAssets(
          tx,
          assets.map((a) => a.id),
          input.targets,
        );
        for (const asset of assets)
          await tx.sharedAttachment.update({
            where: { id: asset.id },
            data: { version: { increment: 1 } },
          });
        await bumpOwners(tx, assets.flatMap(assetOwners));
      } else if (input.operation === 'merge') {
        const keeper = assets[0];
        if (assets.some((a) => a.objectKey !== keeper.objectKey))
          throw new ApiError(400, 'INVALID_IMAGE');
        const owners = assets.flatMap(assetOwners);
        for (const asset of assets.slice(1)) {
          for (const membership of asset.distributors) {
            const duplicate = await tx.distributorAttachment.findFirst({
              where: { distributorId: membership.distributorId, assetId: keeper.id },
            });
            if (duplicate) await tx.distributorAttachment.delete({ where: { id: membership.id } });
            else
              await tx.distributorAttachment.update({
                where: { id: membership.id },
                data: { assetId: keeper.id },
              });
          }
          for (const membership of asset.batches) {
            const duplicate = await tx.materialBatchAttachment.findFirst({
              where: { batchId: membership.batchId, assetId: keeper.id },
            });
            if (duplicate)
              await tx.materialBatchAttachment.delete({ where: { id: membership.id } });
            else
              await tx.materialBatchAttachment.update({
                where: { id: membership.id },
                data: { assetId: keeper.id },
              });
          }
          await tx.sharedAttachment.delete({ where: { id: asset.id } });
        }
        await updateSharedAsset(
          tx,
          { id: keeper.id, version: keeper.version },
          {
            notes: input.notes,
            objectKey: keeper.objectKey,
            url: keeper.url,
            fileName: keeper.fileName,
          },
        );
        await bumpOwners(tx, owners);
      } else {
        const owners = assets.flatMap(assetOwners);
        if (input.operation === 'unlink') owners.push(input.owner);
        if (input.operation === 'unlink') await ownerAttachments(tx, input.owner);
        for (const asset of assets) {
          if (input.operation === 'delete')
            await tx.sharedAttachment.delete({ where: { id: asset.id } });
          else {
            if (input.owner.type === 'batch')
              await tx.materialBatchAttachment.deleteMany({
                where: { batchId: input.owner.id, assetId: asset.id },
              });
            else
              await tx.distributorAttachment.deleteMany({
                where: { distributorId: input.owner.id, assetId: asset.id },
              });
            await tx.sharedAttachment.update({
              where: { id: asset.id },
              data: { version: { increment: 1 } },
            });
          }
        }
        await bumpOwners(tx, owners);
        for (const owner of owners) await repairCover(tx, owner);
      }
      return { ok: true };
    },
    { timeout: 20000 },
  );
}
export async function attachmentDetails(id: string) {
  await readAsset(db, id);
  return db.sharedAttachment.findUniqueOrThrow({
    where: { id },
    include: {
      distributors: { include: { distributor: { select: { id: true, name: true } } } },
      batches: { include: { batch: { select: { id: true, name: true } } } },
    },
  });
}
export async function attachmentConflicts(ids: string[], targets: AttachmentOwner[]) {
  const source = await db.sharedAttachment.findMany({
    where: { id: { in: ids } },
    select: { id: true, objectKey: true },
  });
  const rows = [];
  for (const target of targets) {
    const current = await ownerAttachments(db, target);
    for (const item of current.attachments)
      if (source.some((a) => a.objectKey === item.objectKey && a.id !== item.assetId))
        rows.push(await attachmentDetails(item.assetId));
  }
  return rows;
}
export const sharedAttachmentSelection = sharedAssetSelect;
