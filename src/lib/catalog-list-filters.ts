import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { findAliasIds } from '@/lib/catalog-search';
import { createdTimeWhere } from '@/lib/date-range';
import type { listSchema, materialListSchema } from '@/lib/validation';
import {
  materialCategoryGroupIds,
  materialCategorySubtreeIds,
} from '@/lib/material-category-groups';

type MaterialCategoryRow = { id: string; name: string; parentId: string | null };

export async function productListWhere(filters: z.infer<typeof listSchema>) {
  const aliasIds = await findAliasIds('product', filters.q ?? '');
  const additionalConditions: Prisma.ProductWhereInput[] = [];
  if (filters.settingStyleId === 'unset') {
    additionalConditions.push({
      OR: [{ extraInfo: { is: null } }, { extraInfo: { is: { settingStyleId: null } } }],
    });
  }
  for (const field of ['videoShot', 'xiaohongshuVideoPublished', 'xiaohongshuListed'] as const) {
    const value = filters[field];
    if (value === 'true') {
      additionalConditions.push({ marketing: { is: { [field]: true } } });
    } else if (value === 'false') {
      additionalConditions.push({
        OR: [{ marketing: { is: null } }, { marketing: { is: { [field]: false } } }],
      });
    }
  }
  const where: Prisma.ProductWhereInput = {
    ...createdTimeWhere(filters),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { code: { contains: filters.q, mode: 'insensitive' } },
            { id: { in: aliasIds } },
          ],
        }
      : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.excludeCategoryName
      ? { category: { name: { not: filters.excludeCategoryName } } }
      : {}),
    ...(filters.tagId ? { tags: { some: { tagId: filters.tagId } } } : {}),
    ...(filters.origin ? { origin: filters.origin } : {}),
    ...(filters.settingStyleId && filters.settingStyleId !== 'unset'
      ? { extraInfo: { is: { settingStyleId: filters.settingStyleId } } }
      : {}),
    ...(filters.published ? { published: filters.published === 'true' } : {}),
    ...(filters.stock ? { stock: filters.stock === '1' ? { gt: 0 } : 0 } : {}),
    ...(additionalConditions.length ? { AND: additionalConditions } : {}),
  };
  return where;
}

export async function materialListWhere(
  filters: z.infer<typeof materialListSchema>,
  categoryRows?: MaterialCategoryRow[],
) {
  let categoryIds: string[] | undefined;
  if (filters.categoryId || filters.categoryGroup) {
    const categories =
      categoryRows ??
      (await db.materialCategory.findMany({
        select: { id: true, name: true, parentId: true },
      }));
    if (filters.categoryId && !categories.some((category) => category.id === filters.categoryId))
      throw new ApiError(400, 'MATERIAL_CATEGORY_NOT_FOUND');
    const selectedIds = filters.categoryId
      ? materialCategorySubtreeIds(categories, [filters.categoryId])
      : undefined;
    if (filters.categoryGroup) {
      const groupIds = materialCategoryGroupIds(categories, filters.categoryGroup);
      categoryIds = [...groupIds].filter((id) => !selectedIds || selectedIds.has(id));
    } else if (selectedIds) {
      categoryIds = [...selectedIds];
    }
  }
  const aliasIds = await findAliasIds('material', filters.q ?? '');
  const where: Prisma.MaterialWhereInput = {
    ...createdTimeWhere(filters),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { id: { in: aliasIds } },
            { tags: { some: { tag: { name: { contains: filters.q, mode: 'insensitive' } } } } },
          ],
        }
      : {}),
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(filters.source
      ? {
          imageImportItems: {
            [filters.source === 'IMAGE_IMPORT' ? 'some' : 'none']: { entryId: { not: null } },
          },
        }
      : {}),
  };
  return where;
}
