import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { categoryUpdateSchema } from '@/lib/validation';
import { Prisma } from '@prisma/client';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const category = await db.category.findUnique({ where: { id: (await params).id } });
    if (!category) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(category);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const data = categoryUpdateSchema.parse(await request.json());
    const id = (await params).id;
    const category = await db.$transaction(
      async (tx) => {
        const current = await tx.category.findUnique({ where: { id } });
        if (!current) throw new ApiError(404, 'NOT_FOUND');
        if (current.name === '蛋面' && data.name !== '蛋面') {
          const count = await tx.cabochonMeasurement.count({
            where: { product: { categoryId: id } },
          });
          if (count) throw new ApiError(409, 'CABOCHON_MEASUREMENTS_IN_USE');
          const costCount = await tx.cabochonCost.count({
            where: { product: { categoryId: id } },
          });
          if (costCount) throw new ApiError(409, 'CABOCHON_COSTS_IN_USE');
        }
        return tx.category.update({ where: { id }, data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(category);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    const count = await db.product.count({ where: { categoryId: id } });
    if (count) throw new ApiError(409, 'IN_USE');
    await db.category.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
