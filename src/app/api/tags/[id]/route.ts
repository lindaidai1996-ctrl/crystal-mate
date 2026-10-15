import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { tagSchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const tag = await db.tag.findUnique({ where: { id: (await params).id } });
    if (!tag) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(tag);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const data = tagSchema.parse(await request.json());
    return NextResponse.json(await db.tag.update({ where: { id: (await params).id }, data }));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    const [products, materials] = await db.$transaction([
      db.productTag.count({ where: { tagId: id } }),
      db.materialTag.count({ where: { tagId: id } }),
    ]);
    if (products || materials) throw new ApiError(409, 'TAG_IN_USE');
    await db.tag.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
      return apiError(new ApiError(409, 'TAG_IN_USE'));
    return apiError(error);
  }
}
