import type { Prisma } from '@prisma/client';
import { ApiError } from './api';
import {
  attachmentCoverKey,
  MAX_ATTACHMENTS,
  type AttachmentOwner,
  type AttachmentSource,
} from './attachments';
import { resolveAttachmentSources } from './attachment-candidates';

type AttachmentInput = {
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
