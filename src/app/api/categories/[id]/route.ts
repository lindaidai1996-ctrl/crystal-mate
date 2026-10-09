import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { categorySchema } from '@/lib/validation';

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
    const data = categorySchema.parse(await request.json());
    return NextResponse.json(await db.category.update({ where: { id: (await params).id }, data }));
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
