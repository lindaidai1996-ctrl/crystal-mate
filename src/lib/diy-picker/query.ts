import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { materialInclude, serializeMaterial } from '@/lib/materials';
import { productInclude, serializeProduct } from '@/lib/products';
import { materialListWhere, productListWhere } from '@/lib/catalog-list-filters';
import { materialListSchema, listSchema } from '@/lib/validation';
import type { PickerFilters } from './contracts';

export function dimensionWhere(filters: PickerFilters) {
  const where: Record<string, { gte?: number; lte?: number }> = {};
  for (const field of ['length', 'width', 'height'] as const) {
    const min = filters[`${field}Min`];
    const max = filters[`${field}Max`];
    if (min !== undefined || max !== undefined)
      where[`${field}Mm`] = {
        ...(min !== undefined ? { gte: min } : {}),
        ...(max !== undefined ? { lte: max } : {}),
      };
  }
  return where;
}

export function batchWhere(
  filters: PickerFilters,
  recentEntryIds?: string[],
): Prisma.MaterialBatchEntryWhereInput {
  return {
    ...dimensionWhere(filters),
    ...(filters.distributorId ? { distributorId: filters.distributorId } : {}),
    ...(filters.stock === 'available' ? { remainingQty: { gt: 0 } } : {}),
    ...(recentEntryIds ? { id: { in: recentEntryIds } } : {}),
  };
}

export async function listPickerMaterials(ownerId: string, filters: PickerFilters) {
  const base = await materialListWhere(
    materialListSchema.parse({ q: filters.q, categoryId: filters.categoryId }),
  );
  return db.$transaction(
    async (tx) => {
      const recents =
        filters.source === 'recent'
          ? await tx.diyRecentMaterial.findMany({
              where: { ownerId },
              orderBy: [{ usedAt: 'desc' }, { entryId: 'asc' }],
              select: { entryId: true },
            })
          : undefined;
      const entryFilter = batchWhere(
        filters,
        recents?.map((row) => row.entryId),
      );
      const where: Prisma.MaterialWhereInput = {
        ...base,
        NOT: { pricingGroup: { is: { enabled: true } } },
        ...(filters.tagId ? { tags: { some: { tagId: filters.tagId } } } : {}),
        batchEntries: { some: entryFilter },
      };
      const include = {
        ...materialInclude,
        batchEntries: { where: entryFilter, include: materialInclude.batchEntries.include },
      };
      const total = await tx.material.count({ where });
      const items = await tx.material.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(recents ? {} : { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      });
      if (recents) {
        const ranks = new Map(recents.map((row, index) => [row.entryId, index]));
        const rank = (item: (typeof items)[number]) =>
          Math.min(...item.batchEntries.map((entry) => ranks.get(entry.id) ?? Infinity));
        items.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
      }
      const page = recents
        ? items.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize)
        : items;
      return {
        items: page.map((item) => {
          const serialized = serializeMaterial(item);
          if (recents) {
            const ranks = new Map(recents.map((row, index) => [row.entryId, index]));
            serialized.batchEntries.sort(
              (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
            );
          }
          return serialized;
        }),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function listPickerCabochons(ownerId: string, filters: PickerFilters) {
  const base = await productListWhere(listSchema.parse({ q: filters.q, tagId: filters.tagId }));
  return db.$transaction(
    async (tx) => {
      const recents =
        filters.source === 'recent'
          ? await tx.diyRecentCabochon.findMany({
              where: { ownerId },
              orderBy: [{ usedAt: 'desc' }, { productId: 'asc' }],
              select: { productId: true },
            })
          : undefined;
      const dimensions = dimensionWhere(filters);
      const where: Prisma.ProductWhereInput = {
        ...base,
        category: { name: '蛋面' },
        ...(filters.excludeProductId ? { id: { not: filters.excludeProductId } } : {}),
        ...(recents
          ? {
              AND: [
                { id: { in: recents.map((row) => row.productId) } },
                ...(base.AND ? [base.AND].flat() : []),
              ],
            }
          : {}),
        ...(filters.stock === 'available' ? { stock: { gt: 0 } } : {}),
        ...(Object.keys(dimensions).length ? { measurement: { is: dimensions } } : {}),
      };
      const total = await tx.product.count({ where });
      const items = await tx.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(recents ? {} : { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      });
      if (recents) {
        const ranks = new Map(recents.map((row, index) => [row.productId, index]));
        items.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
      }
      const page = recents
        ? items.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize)
        : items;
      return {
        items: page.map(serializeProduct),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
