import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { categorySchema } from '@/lib/validation';
import { getNextCategoryPrefix } from '@/lib/product-code';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await db.category.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = categorySchema.parse(await request.json());
    const category = await db.$transaction(
      async (tx) => {
        const categories = await tx.category.findMany({ select: { prefix: true } });
        return tx.category.create({
          data: { ...data, prefix: getNextCategoryPrefix(categories.map((item) => item.prefix)) },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
