import { lockAttachments } from './shared-attachments';
import { attachmentListInclude } from '@/lib/shared-attachment-query';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { saveOwnerAttachments, resolveSavedCover } from './attachment-save';
import { materialBatchWriteSchema } from '@/lib/validation';

type BatchInput = z.infer<typeof materialBatchWriteSchema>;

export const batchInclude = {
  attachments: attachmentListInclude,
  _count: { select: { entries: true, productEntries: true, attachments: true } },
} satisfies Prisma.MaterialBatchInclude;

export async function createBatch(input: BatchInput) {
  return db.$transaction(
    async (tx) => {
      await lockAttachments(tx);
      const batch = await tx.materialBatch.create({
        data: {
          coverObjectKey: resolveSavedCover(input.attachments, input.coverObjectKey),
          name: input.name,
          receivedAt: new Date(`${input.receivedAt}T00:00:00.000Z`),
          notes: input.notes,
        },
      });
      await saveOwnerAttachments(
        tx,
        { type: 'batch', id: batch.id },
        input.attachments,
        undefined,
        true,
      );
      return tx.materialBatch.findUniqueOrThrow({ where: { id: batch.id }, include: batchInclude });
    },
    { timeout: 20000 },
  );
}

export async function updateBatch(id: string, input: BatchInput) {
  return db.$transaction(
    async (tx) => {
      await lockAttachments(tx);
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
      await saveOwnerAttachments(
        tx,
        { type: 'batch', id },
        input.attachments,
        input.attachmentsVersion,
      );
      return tx.materialBatch.findUniqueOrThrow({ where: { id }, include: batchInclude });
    },
    { timeout: 20000 },
  );
}
