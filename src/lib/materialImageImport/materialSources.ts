import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import type { MaterialImageImportSource } from '@/lib/client-types';

export async function materialImageImportSources(
  materialId: string,
): Promise<MaterialImageImportSource[]> {
  const material = await db.material.findUnique({
    where: { id: materialId },
    select: { id: true },
  });
  if (!material) throw new ApiError(404, 'NOT_FOUND');
  const items = await db.materialImageImportItem.findMany({
    where: { materialId, entryId: { not: null } },
    orderBy: { entry: { createdAt: 'desc' } },
    select: {
      id: true,
      import: {
        select: { id: true, fileName: true, sourceUrl: true, createdAt: true, archivedAt: true },
      },
      entry: {
        select: {
          id: true,
          createdAt: true,
          batch: { select: { id: true, name: true } },
          distributor: { select: { id: true, name: true } },
        },
      },
    },
  });
  return items.flatMap((item) =>
    item.entry
      ? [
          {
            itemId: item.id,
            importId: item.import.id,
            fileName: item.import.fileName,
            sourceUrl: item.import.sourceUrl,
            importedAt: item.import.createdAt.toISOString(),
            archivedAt: item.import.archivedAt?.toISOString() ?? null,
            entryId: item.entry.id,
            receivedAt: item.entry.createdAt.toISOString(),
            batch: item.entry.batch,
            distributor: item.entry.distributor,
          },
        ]
      : [],
  );
}
