import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { catalogRefSchema, purchaseRefSchema } from './contracts';
import { CANDIDATE_LIMIT, CandidateQueryError } from './candidate-contracts';
import { imageObjectKeyPattern } from '@/lib/image-storage';

export const catalogDisplaySchema = z.strictObject({
  item: catalogRefSchema,
  purchase: purchaseRefSchema.nullable().default(null),
  name: z.string(),
  code: z.string().nullable(),
  imageKey: z.string().regex(imageObjectKeyPattern).nullable(),
  lengthMm: z.string().nullable(),
  widthMm: z.string().nullable(),
  heightMm: z.string().nullable(),
});
export type CatalogDisplay = z.infer<typeof catalogDisplaySchema>;

// Server-selected identities only. Called inside the authenticated service's read-only transaction.
export async function readAssistantDisplay(
  tx: Prisma.TransactionClient,
  refs: { item: CatalogDisplay['item']; purchase: CatalogDisplay['purchase'] }[],
) {
  const selected = z
    .array(z.strictObject({ item: catalogRefSchema, purchase: purchaseRefSchema.nullable() }))
    .max(CANDIDATE_LIMIT)
    .parse(refs);
  const unique = [
    ...new Map(selected.map(({ item }) => [`${item.type}:${item.id}`, item])).values(),
  ];
  const images = { select: { objectKey: true }, orderBy: { position: 'asc' as const }, take: 1 };
  const [materials, entries, products] = await Promise.all([
    tx.material.findMany({
      where: { id: { in: unique.filter((r) => r.type === 'MATERIAL').map((r) => r.id) } },
      select: {
        id: true,
        name: true,
        images,
        lengthMm: true,
        widthMm: true,
        heightMm: true,
        batchEntries: {
          where: { images: { some: {} } },
          orderBy: [{ batch: { receivedAt: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { images },
        },
      },
    }),
    tx.materialBatchEntry.findMany({
      where: {
        id: {
          in: selected.flatMap((row) =>
            row.purchase?.type === 'MATERIAL_PURCHASE' ? [row.purchase.id] : [],
          ),
        },
      },
      select: { id: true, materialId: true, images, lengthMm: true, widthMm: true, heightMm: true },
    }),
    tx.product.findMany({
      where: { id: { in: unique.filter((r) => r.type === 'PRODUCT').map((r) => r.id) } },
      select: {
        id: true,
        name: true,
        code: true,
        images,
        measurement: { select: { lengthMm: true, widthMm: true, heightMm: true } },
      },
    }),
  ]);
  if (materials.length + products.length !== unique.length)
    throw new CandidateQueryError('DISPLAY_SNAPSHOT_CHANGED');
  const catalogRows = [
    ...materials.map((row) => ({
      ...row,
      images: row.images.length ? row.images : (row.batchEntries[0]?.images ?? []),
      item: { type: 'MATERIAL' as const, id: row.id },
      code: null,
    })),
    ...products.map((row) => ({
      ...row,
      ...row.measurement,
      item: { type: 'PRODUCT' as const, id: row.id },
    })),
  ];
  return selected.map((ref) => {
    const catalog = catalogRows.find(
      (row) => row.item.type === ref.item.type && row.item.id === ref.item.id,
    )!;
    const entry =
      ref.purchase?.type === 'MATERIAL_PURCHASE'
        ? entries.find((row) => row.id === ref.purchase?.id && row.materialId === ref.item.id)
        : null;
    if (ref.purchase?.type === 'MATERIAL_PURCHASE' && !entry)
      throw new CandidateQueryError('DISPLAY_SNAPSHOT_CHANGED');
    const row = entry
      ? { ...catalog, ...entry, images: entry.images.length ? entry.images : catalog.images }
      : catalog;
    return catalogDisplaySchema.parse({
      item: row.item,
      purchase: ref.purchase,
      name: row.name,
      code: row.code,
      imageKey:
        row.images[0] && imageObjectKeyPattern.test(row.images[0].objectKey)
          ? row.images[0].objectKey
          : null,
      lengthMm: row.lengthMm?.toString() ?? null,
      widthMm: row.widthMm?.toString() ?? null,
      heightMm: row.heightMm?.toString() ?? null,
    });
  });
}
