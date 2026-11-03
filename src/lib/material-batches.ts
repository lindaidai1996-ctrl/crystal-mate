import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { prepareAttachments, resolveSavedCover } from './attachment-save';
import { materialBatchWriteSchema } from '@/lib/validation';

type BatchInput = z.infer<typeof materialBatchWriteSchema>;
type Tx = Prisma.TransactionClient;

export const batchInclude = {
  attachments: { orderBy: { position: 'asc' } },
  _count: { select: { entries: true, productEntries: true, attachments: true } },
} satisfies Prisma.MaterialBatchInclude;

async function replaceAttachments(tx: Tx, batchId: string, attachments: BatchInput['attachments']) {
  const existing = await tx.materialBatchAttachment.findMany({ where: { batchId } });
  const data = await prepareAttachments(tx, { type: 'batch', id: batchId }, attachments, existing);
  await tx.materialBatchAttachment.deleteMany({ where: { batchId } });
  if (data.length)
    await tx.materialBatchAttachment.createMany({
      data: data.map((attachment) => ({ ...attachment, batchId })),
    });
}

export async function createBatch(input: BatchInput) {
  return db.$transaction(async (tx) => {
    const batch = await tx.materialBatch.create({
      data: {
        coverObjectKey: resolveSavedCover(input.attachments, input.coverObjectKey),
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
    const current = await tx.materialBatch.findUnique({
      where: { id },
      select: { coverObjectKey: true },
    });
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    await tx.materialBatch.update({
      where: { id },
      data: {
        coverObjectKey: resolveSavedCover(
          input.attachments,
          input.coverObjectKey,
          current.coverObjectKey,
        ),
        name: input.name,
        receivedAt: new Date(`${input.receivedAt}T00:00:00.000Z`),
        notes: input.notes,
      },
    });
    await replaceAttachments(tx, id, input.attachments);
    return tx.materialBatch.findUniqueOrThrow({ where: { id }, include: batchInclude });
  });
}
