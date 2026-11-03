import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { prepareAttachments, resolveSavedCover } from './attachment-save';
import { distributorSchema } from '@/lib/validation';

type DistributorInput = z.infer<typeof distributorSchema>;
type Tx = Prisma.TransactionClient;

export const distributorInclude = {
  attachments: { orderBy: { position: 'asc' as const } },
  _count: { select: { attachments: true } },
} satisfies Prisma.DistributorInclude;

async function replaceAttachments(
  tx: Tx,
  distributorId: string,
  attachments: NonNullable<DistributorInput['attachments']>,
) {
  const existing = await tx.distributorAttachment.findMany({ where: { distributorId } });
  const data = await prepareAttachments(
    tx,
    { type: 'distributor', id: distributorId },
    attachments,
    existing,
  );
  await tx.distributorAttachment.deleteMany({ where: { distributorId } });
  if (data.length)
    await tx.distributorAttachment.createMany({
      data: data.map((attachment) => ({ ...attachment, distributorId })),
    });
}

export async function createDistributor(input: DistributorInput) {
  return db.$transaction(async (tx) => {
    const { attachments = [], coverObjectKey, ...data } = input;
    await tx.distributorArea.upsert({
      where: { name: data.area },
      create: { name: data.area },
      update: {},
    });
    const distributor = await tx.distributor.create({
      data: { ...data, coverObjectKey: resolveSavedCover(attachments, coverObjectKey) },
    });
    await replaceAttachments(tx, distributor.id, attachments);
    return tx.distributor.findUniqueOrThrow({
      where: { id: distributor.id },
      include: distributorInclude,
    });
  });
}

export async function updateDistributor(id: string, input: DistributorInput) {
  return db.$transaction(async (tx) => {
    const { attachments, coverObjectKey, ...data } = input;
    const current = await tx.distributor.findUnique({ where: { id }, include: distributorInclude });
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
    if (attachments) await replaceAttachments(tx, id, attachments);
    return tx.distributor.findUniqueOrThrow({ where: { id }, include: distributorInclude });
  });
}
