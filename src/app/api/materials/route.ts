import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialListSchema, materialCreateSchema } from '@/lib/validation';
import { createMaterial, materialInclude, serializeMaterial } from '@/lib/materials';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = materialListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    let categoryIds: string[] | undefined;
    if (filters.categoryId) {
      const categories = await db.materialCategory.findMany({
        select: { id: true, parentId: true },
      });
      if (!categories.some((category) => category.id === filters.categoryId))
        throw new ApiError(400, 'MATERIAL_CATEGORY_NOT_FOUND');
      categoryIds = [filters.categoryId];
      for (let index = 0; index < categoryIds.length; index++) {
        categoryIds.push(
          ...categories
            .filter((category) => category.parentId === categoryIds![index])
            .map((category) => category.id),
        );
      }
    }
    const where: Prisma.MaterialWhereInput = {
      ...(filters.q ? { name: { contains: filters.q, mode: 'insensitive' } } : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
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
