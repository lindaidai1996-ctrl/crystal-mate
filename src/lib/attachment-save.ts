import type { Prisma } from '@prisma/client';
import { ApiError } from './api';
import {
  attachmentCoverKey,
  MAX_ATTACHMENTS,
  type AttachmentOwner,
  type AttachmentSource,
} from './attachments';
import { resolveAttachmentSources } from './attachment-candidates';

export type AttachmentInput = {
  assetId?: string;
  version?: number;
  targets?: AttachmentOwner[];
  objectKey: string;
  fileName: string;
  notes: string;
  source?: AttachmentSource;
};
type ExistingAttachment = { objectKey: string; url: string };

export function resolveSavedCover(
  attachments: Pick<AttachmentInput, 'objectKey'>[],
  requested: string | null | undefined,
  previous?: string | null,
) {
  if (requested && !attachments.some((item) => item.objectKey === requested))
    throw new ApiError(400, 'INVALID_IMAGE');
  return attachmentCoverKey(attachments, requested === undefined ? previous : requested);
}

export async function prepareAttachments(
  tx: Prisma.TransactionClient,
  owner: AttachmentOwner,
  attachments: AttachmentInput[],
  existing: ExistingAttachment[],
) {
  const keys = attachments.map((attachment) => attachment.objectKey);
  if (attachments.length > MAX_ATTACHMENTS || new Set(keys).size !== keys.length)
    throw new ApiError(400, 'INVALID_IMAGE');
  const existingByKey = new Map(existing.map((attachment) => [attachment.objectKey, attachment]));
  const fresh = attachments.filter((item) => !existingByKey.has(item.objectKey));
  const sources = await resolveAttachmentSources(
    tx,
    owner,
    fresh.filter((item) => item.source),
  );
  const uploadedKeys = fresh.filter((item) => !item.source).map((item) => item.objectKey);
  const grantWhere = {
    objectKey: { in: uploadedKeys },
    uploadedAt: { not: null },
    usedAt: null,
    expiresAt: { gt: new Date() },
  };
  const grants = uploadedKeys.length ? await tx.uploadGrant.findMany({ where: grantWhere }) : [];
  if (grants.length !== uploadedKeys.length) throw new ApiError(400, 'INVALID_IMAGE');
  const grantByKey = new Map(grants.map((grant) => [grant.objectKey, grant]));
  if (uploadedKeys.length) {
    const consumed = await tx.uploadGrant.updateMany({
      where: grantWhere,
      data: { usedAt: new Date() },
    });
    if (consumed.count !== uploadedKeys.length) throw new ApiError(400, 'INVALID_IMAGE');
  }
  return attachments.map((attachment, position) => ({
    objectKey: attachment.objectKey,
    url:
      existingByKey.get(attachment.objectKey)?.url ??
      sources.get(attachment.objectKey)?.url ??
      grantByKey.get(attachment.objectKey)!.url,
    fileName: sources.get(attachment.objectKey)?.fileName ?? attachment.fileName,
    notes: attachment.notes,
    position,
  }));
}

// Stable memberships and shared content replace the former delete/recreate save.
export async function saveOwnerAttachments(
  tx: Prisma.TransactionClient,
  owner: AttachmentOwner,
  inputs: AttachmentInput[],
  expectedVersion?: number,
  creating = false,
) {
  const { ownerAttachments, updateSharedAsset, linkAssets, bumpOwners, repairCover } = await import(
    './shared-attachments'
  );
  const current = await ownerAttachments(tx, owner);
  if (!creating && expectedVersion !== current.attachmentsVersion)
    throw new ApiError(409, 'ATTACHMENT_CONFLICT');
  const before = current.attachments;
  const byId = new Map(before.map((a) => [a.assetId, a]));
  for (const input of inputs) {
    const old = input.assetId ? byId.get(input.assetId) : undefined;
    if (input.assetId && (!old || input.version !== old.asset.version))
      throw new ApiError(409, 'ATTACHMENT_CONFLICT');
    if (!input.assetId && before.some((a) => a.objectKey === input.objectKey))
      throw new ApiError(409, 'ATTACHMENT_CONFLICT');
  }
  const prepared = await prepareAttachments(tx, owner, inputs, before);
  const unchanged =
    inputs.length === before.length &&
    inputs.every((input, index) => {
      const old = before[index];
      const data = prepared[index];
      return (
        input.assetId === old.assetId &&
        old.position === index &&
        old.objectKey === data.objectKey &&
        old.fileName === data.fileName &&
        old.notes === data.notes &&
        !input.targets?.length
      );
    });
  if (unchanged) return [];
  const kept = new Set(inputs.flatMap((input) => (input.assetId ? [input.assetId] : [])));
  for (const row of before)
    if (!kept.has(row.assetId)) {
      if (owner.type === 'batch')
        await tx.materialBatchAttachment.delete({ where: { id: row.id } });
      else await tx.distributorAttachment.delete({ where: { id: row.id } });
      await tx.sharedAttachment.update({
        where: { id: row.assetId },
        data: { version: { increment: 1 } },
      });
    }
  // Move retained positions out of the destination range before reordering.
  if (owner.type === 'batch')
    await tx.materialBatchAttachment.updateMany({
      where: { batchId: owner.id },
      data: { position: { increment: 100000 } },
    });
  else
    await tx.distributorAttachment.updateMany({
      where: { distributorId: owner.id },
      data: { position: { increment: 100000 } },
    });
  const newIds: string[] = [];
  for (const [index, input] of inputs.entries()) {
    const old = input.assetId ? byId.get(input.assetId) : undefined;
    const data = prepared[index];
    let assetId = input.assetId;
    if (old) {
      if (
        old.objectKey !== data.objectKey ||
        old.notes !== data.notes ||
        old.fileName !== data.fileName
      ) {
        await updateSharedAsset(
          tx,
          { id: old.assetId, version: input.version! },
          { objectKey: data.objectKey, url: data.url, fileName: data.fileName, notes: data.notes },
        );
      }
      if (owner.type === 'batch')
        await tx.materialBatchAttachment.update({
          where: { id: old.id },
          data: { position: index },
        });
      else
        await tx.distributorAttachment.update({ where: { id: old.id }, data: { position: index } });
    } else {
      const asset = await tx.sharedAttachment.create({
        data: {
          objectKey: data.objectKey,
          url: data.url,
          fileName: data.fileName,
          notes: data.notes,
        },
      });
      assetId = asset.id;
      if (owner.type === 'batch')
        await tx.materialBatchAttachment.create({ data: { ...data, assetId, batchId: owner.id } });
      else
        await tx.distributorAttachment.create({
          data: { ...data, assetId, distributorId: owner.id },
        });
      newIds.push(assetId);
    }
    if (input.targets?.length) await linkAssets(tx, [assetId!], input.targets);
  }
  await bumpOwners(tx, [owner]);
  await repairCover(tx, owner);
  return newIds;
}
