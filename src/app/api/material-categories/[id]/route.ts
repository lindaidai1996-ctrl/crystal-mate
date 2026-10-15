import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialCategorySchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const category = await db.materialCategory.findUnique({ where: { id: (await params).id } });
    if (!category) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(category);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    const data = materialCategorySchema.parse(await request.json());
    const updated = await db.$transaction(
      async (tx) => {
        if (!(await tx.materialCategory.findUnique({ where: { id } })))
          throw new ApiError(404, 'NOT_FOUND');
        let cursor = data.parentId;
        while (cursor) {
          if (cursor === id) throw new ApiError(400, 'MATERIAL_CATEGORY_CYCLE');
          const parent = await tx.materialCategory.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
          if (!parent) throw new ApiError(400, 'MATERIAL_CATEGORY_NOT_FOUND');
          cursor = parent.parentId;
        }
        return tx.materialCategory.update({ where: { id }, data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    const category = await db.materialCategory.findUnique({
      where: { id },
      include: { _count: { select: { children: true, materials: true } } },
    });
    if (!category) throw new ApiError(404, 'NOT_FOUND');
    if (category._count.children || category._count.materials)
      throw new ApiError(409, 'MATERIAL_CATEGORY_IN_USE');
    await db.materialCategory.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
