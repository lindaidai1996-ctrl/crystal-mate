import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { listSchema, productSchema } from '@/lib/validation';
import { saveProduct } from '@/lib/products';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = listSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const where: Prisma.ProductWhereInput = {
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: 'insensitive' } },
              { code: { contains: filters.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.published ? { published: filters.published === 'true' } : {}),
      ...(filters.stock ? { stock: Number(filters.stock) } : {}),
    };
    const [items, total] = await db.$transaction([
      db.product.findMany({
        where,
        include: { category: true, images: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      db.product.count({ where }),
    ]);
    return NextResponse.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = productSchema.parse(await request.json());
    return NextResponse.json(await saveProduct(data), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
