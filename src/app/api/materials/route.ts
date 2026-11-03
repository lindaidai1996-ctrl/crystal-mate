import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { findAliasIds } from '@/lib/catalog-search';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialListSchema, materialCreateSchema } from '@/lib/validation';
import { createMaterial, materialInclude, serializeMaterial } from '@/lib/materials';
import { createdTimeWhere } from '@/lib/date-range';
import {
  materialCategoryGroupIds,
  materialCategorySubtreeIds,
} from '@/lib/material-category-groups';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = materialListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    let categoryIds: string[] | undefined;
    if (filters.categoryId || filters.categoryGroup) {
      const categories = await db.materialCategory.findMany({
        select: { id: true, name: true, parentId: true },
      });
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
        ? { OR: [{ name: { contains: filters.q, mode: 'insensitive' } }, { id: { in: aliasIds } }] }
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
    const [items, total] = await db.$transaction([
      db.material.findMany({
        where,
        include: materialInclude,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      db.material.count({ where }),
    ]);
    return NextResponse.json({
      items: items.map(serializeMaterial),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await createMaterial(materialCreateSchema.parse(await request.json())),
      {
        status: 201,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
