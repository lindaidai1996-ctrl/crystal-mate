import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
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
  const keys = attachments.map((attachment) => attachment.objectKey);
  if (new Set(keys).size !== keys.length) throw new ApiError(400, 'INVALID_IMAGE');

  const existing = await tx.distributorAttachment.findMany({ where: { distributorId } });
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

  await tx.distributorAttachment.deleteMany({ where: { distributorId } });
  if (attachments.length)
    await tx.distributorAttachment.createMany({
      data: attachments.map((attachment, position) => ({
        distributorId,
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

export async function createDistributor(input: DistributorInput) {
  return db.$transaction(async (tx) => {
    const { attachments = [], ...data } = input;
    await tx.distributorArea.upsert({
      where: { name: data.area },
      create: { name: data.area },
      update: {},
    });
    const distributor = await tx.distributor.create({ data });
    await replaceAttachments(tx, distributor.id, attachments);
    return tx.distributor.findUniqueOrThrow({
      where: { id: distributor.id },
      include: distributorInclude,
    });
  });
}

export async function updateDistributor(id: string, input: DistributorInput) {
  return db.$transaction(async (tx) => {
    const { attachments, ...data } = input;
    await tx.distributorArea.upsert({
      where: { name: data.area },
      create: { name: data.area },
      update: {},
    });
    await tx.distributor.update({ where: { id }, data });
    if (attachments) await replaceAttachments(tx, id, attachments);
    return tx.distributor.findUniqueOrThrow({ where: { id }, include: distributorInclude });
  });
}
