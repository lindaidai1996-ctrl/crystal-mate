import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { materialBatchWriteSchema } from '@/lib/validation';

type BatchInput = z.infer<typeof materialBatchWriteSchema>;
type Tx = Prisma.TransactionClient;

export const batchInclude = {
  attachments: { orderBy: { position: 'asc' } },
  _count: { select: { entries: true, productEntries: true, attachments: true } },
} satisfies Prisma.MaterialBatchInclude;

async function replaceAttachments(tx: Tx, batchId: string, attachments: BatchInput['attachments']) {
  const keys = attachments.map((attachment) => attachment.objectKey);
  if (new Set(keys).size !== keys.length) throw new ApiError(400, 'INVALID_IMAGE');

  const existing = await tx.materialBatchAttachment.findMany({ where: { batchId } });
  const existingByKey = new Map(existing.map((attachment) => [attachment.objectKey, attachment]));
  const freshKeys = keys.filter((key) => !existingByKey.has(key));
  const grants = await tx.uploadGrant.findMany({
    where: {
      objectKey: { in: freshKeys },
      uploadedAt: { not: null },
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (grants.length !== freshKeys.length) throw new ApiError(400, 'INVALID_IMAGE');
  const grantByKey = new Map(grants.map((grant) => [grant.objectKey, grant]));

  await tx.materialBatchAttachment.deleteMany({ where: { batchId } });
  if (attachments.length)
    await tx.materialBatchAttachment.createMany({
      data: attachments.map((attachment, position) => ({
        batchId,
        objectKey: attachment.objectKey,
        url:
          existingByKey.get(attachment.objectKey)?.url ?? grantByKey.get(attachment.objectKey)!.url,
        fileName: attachment.fileName,
        notes: attachment.notes,
        position,
      })),
    });
  if (freshKeys.length)
    await tx.uploadGrant.updateMany({
      where: { objectKey: { in: freshKeys }, usedAt: null },
      data: { usedAt: new Date() },
    });
}

export async function createBatch(input: BatchInput) {
  return db.$transaction(async (tx) => {
    const batch = await tx.materialBatch.create({
      data: {
        name: input.name,
        receivedAt: new Date(`${input.receivedAt}T00:00:00.000Z`),
        notes: input.notes,
      },
    });
    await replaceAttachments(tx, batch.id, input.attachments);
    return tx.materialBatch.findUniqueOrThrow({ where: { id: batch.id }, include: batchInclude });
  });
}

export async function updateBatch(id: string, input: BatchInput) {
  return db.$transaction(async (tx) => {
    if (!(await tx.materialBatch.findUnique({ where: { id }, select: { id: true } })))
      throw new ApiError(404, 'NOT_FOUND');
    await tx.materialBatch.update({
      where: { id },
      data: {
        name: input.name,
        receivedAt: new Date(`${input.receivedAt}T00:00:00.000Z`),
        notes: input.notes,
      },
    });
    await replaceAttachments(tx, id, input.attachments);
    return tx.materialBatch.findUniqueOrThrow({ where: { id }, include: batchInclude });
  });
}
