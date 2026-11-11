import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { materialListSchema, materialCreateSchema } from '@/lib/validation';
import { createMaterial, materialInclude, serializeMaterial } from '@/lib/materials';
import { materialListWhere } from '@/lib/catalog-list-filters';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = materialListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const where = await materialListWhere(filters);
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
