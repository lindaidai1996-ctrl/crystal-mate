import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';

export const draftKind = z.enum(['MATERIAL', 'PRODUCT']);
export const draftInput = z.object({
  kind: draftKind,
  title: z.string().max(120),
  data: z.record(z.string(), z.unknown()),
});

export function draftJson(data: Record<string, unknown>): Prisma.InputJsonValue {
  return data as Prisma.InputJsonValue;
}

export async function extendDraftImages(data: Record<string, unknown>) {
  const keys = Array.isArray(data.images)
    ? data.images.flatMap((image) =>
        image &&
        typeof image === 'object' &&
        'objectKey' in image &&
        typeof image.objectKey === 'string'
          ? [image.objectKey]
          : [],
      )
    : [];
  if (!keys.length) return;
  await db.uploadGrant.updateMany({
    where: { objectKey: { in: keys.slice(0, 12) }, uploadedAt: { not: null }, usedAt: null },
    data: { expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000) },
  });
}
