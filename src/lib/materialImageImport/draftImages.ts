import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/api';
import { importItemDataSchema, type ImportItemData } from './contracts';

type DraftRow = { id: string; data: ImportItemData };

// Reserve newly uploaded attachments with this saved draft, just like its source image.
export async function holdDraftImages(
  tx: Prisma.TransactionClient,
  previous: { id: string; data: Prisma.JsonValue }[],
  next: DraftRow[],
  committedIds: Set<string>,
): Promise<DraftRow[]> {
  const editable = next.filter((row) => !committedIds.has(row.id));
  const keys = editable.flatMap(
    (row) => row.data.material?.images.map((image) => image.objectKey) ?? [],
  );
  if (!keys.length) return next;
  // Each upload belongs to one candidate; otherwise it could be consumed twice.
  const allKeys = next.flatMap(
    (row) => row.data.material?.images.map((image) => image.objectKey) ?? [],
  );
  if (new Set(allKeys).size !== allKeys.length) throw new ApiError(400, 'INVALID_IMAGE');
  const grants = await tx.uploadGrant.findMany({
    where: { objectKey: { in: keys }, uploadedAt: { not: null } },
  });
  const byKey = new Map(grants.map((grant) => [grant.objectKey, grant]));
  const previousKeys = new Map(
    previous.map((row) => [
      row.id,
      new Set(
        importItemDataSchema.parse(row.data).material?.images.map((image) => image.objectKey) ?? [],
      ),
    ]),
  );
  const fresh: string[] = [];
  const now = new Date();
  for (const row of editable) {
    for (const image of row.data.material?.images ?? []) {
      const grant = byKey.get(image.objectKey);
      const held = previousKeys.get(row.id)?.has(image.objectKey) && grant?.usedAt;
      if (!grant || (!held && (grant.usedAt || grant.expiresAt <= now)))
        throw new ApiError(400, 'INVALID_IMAGE');
      if (!held) fresh.push(image.objectKey);
    }
  }
  if (fresh.length) {
    const claimed = await tx.uploadGrant.updateMany({
      where: {
        objectKey: { in: fresh },
        uploadedAt: { not: null },
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== fresh.length) throw new ApiError(409, 'IMPORT_CONFLICT');
  }
  return next.map((row) =>
    committedIds.has(row.id) || !row.data.material
      ? row
      : {
          ...row,
          data: {
            ...row.data,
            material: {
              ...row.data.material,
              images: row.data.material.images.map((image) => ({
                ...image,
                url: byKey.get(image.objectKey)!.url,
              })),
            },
          },
        },
  );
}

export async function heldDraftImageUrls(tx: Prisma.TransactionClient, item: ImportItemData) {
  const keys = item.material?.images.map((image) => image.objectKey) ?? [];
  if (!keys.length) return new Map<string, string>();
  const grants = await tx.uploadGrant.findMany({
    where: { objectKey: { in: keys }, uploadedAt: { not: null }, usedAt: { not: null } },
  });
  if (grants.length !== keys.length) throw new ApiError(400, 'INVALID_IMAGE');
  return new Map(grants.map((grant) => [grant.objectKey, grant.url]));
}
