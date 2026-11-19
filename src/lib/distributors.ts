import { lockAttachments } from './shared-attachments';
import { attachmentListInclude } from '@/lib/shared-attachment-query';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { saveOwnerAttachments, resolveSavedCover } from './attachment-save';
import { distributorSchema } from '@/lib/validation';

type DistributorInput = z.infer<typeof distributorSchema>;

export const distributorInclude = {
  attachments: attachmentListInclude,
  _count: { select: { attachments: true } },
} satisfies Prisma.DistributorInclude;

export async function createDistributor(input: DistributorInput) {
  return db.$transaction(
    async (tx) => {
      await lockAttachments(tx);
      const { attachments = [], coverObjectKey, attachmentsVersion: _version, ...data } = input;
      void _version;
      await tx.distributorArea.upsert({
        where: { name: data.area },
        create: { name: data.area },
        update: {},
      });
      const distributor = await tx.distributor.create({
        data: { ...data, coverObjectKey: resolveSavedCover(attachments, coverObjectKey) },
      });
      await saveOwnerAttachments(
        tx,
        { type: 'distributor', id: distributor.id },
        attachments,
        undefined,
        true,
      );
      return tx.distributor.findUniqueOrThrow({
        where: { id: distributor.id },
        include: distributorInclude,
      });
    },
    { timeout: 20000 },
  );
}

export async function updateDistributor(id: string, input: DistributorInput) {
  return db.$transaction(
    async (tx) => {
      await lockAttachments(tx);
      const { attachments, coverObjectKey, attachmentsVersion, ...data } = input;
      const current = await tx.distributor.findUnique({
        where: { id },
        include: distributorInclude,
      });
      if (!current) throw new ApiError(404, 'NOT_FOUND');
      await tx.distributorArea.upsert({
        where: { name: data.area },
        create: { name: data.area },
        update: {},
      });
      await tx.distributor.update({
        where: { id },
        data: {
          ...data,
          coverObjectKey: resolveSavedCover(
            attachments ?? current.attachments,
            coverObjectKey,
            current.coverObjectKey,
          ),
        },
      });
      if (attachments)
        await saveOwnerAttachments(
          tx,
          { type: 'distributor', id },
          attachments,
          attachmentsVersion,
        );
      return tx.distributor.findUniqueOrThrow({ where: { id }, include: distributorInclude });
    },
    { timeout: 20000 },
  );
}
