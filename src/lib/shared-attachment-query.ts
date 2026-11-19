import type { Prisma } from '@prisma/client';

export const sharedAssetSelect = {
  version: true,
  imageVersion: true,
  distributors: { select: { distributor: { select: { id: true, name: true } } } },
  batches: { select: { batch: { select: { id: true, name: true } } } },
} satisfies Prisma.SharedAttachmentSelect;
export const attachmentListInclude = {
  orderBy: { position: 'asc' as const },
  include: { asset: { select: sharedAssetSelect } },
};
