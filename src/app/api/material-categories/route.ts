import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialCategorySchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await db.materialCategory.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { children: true, materials: true } } },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = materialCategorySchema.parse(await request.json());
    if (data.parentId && !(await db.materialCategory.findUnique({ where: { id: data.parentId } })))
      throw new ApiError(400, 'MATERIAL_CATEGORY_NOT_FOUND');
    return NextResponse.json(await db.materialCategory.create({ data }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
