import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { findAliasIds } from '@/lib/catalog-search';
import { apiError, requireAdmin } from '@/lib/api';
import { listSchema, productSchema } from '@/lib/validation';
import { productInclude, saveProduct, serializeProduct } from '@/lib/products';
import { Prisma } from '@prisma/client';
import { createdTimeWhere } from '@/lib/date-range';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = listSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const aliasIds = await findAliasIds('product', filters.q ?? '');
    const where: Prisma.ProductWhereInput = {
      ...createdTimeWhere(filters),
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: 'insensitive' } },
              { code: { contains: filters.q, mode: 'insensitive' } },
              { id: { in: aliasIds } },
            ],
          }
        : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.excludeCategoryName
        ? { category: { name: { not: filters.excludeCategoryName } } }
        : {}),
      ...(filters.tagId ? { tags: { some: { tagId: filters.tagId } } } : {}),
      ...(filters.published ? { published: filters.published === 'true' } : {}),
      ...(filters.stock ? { stock: filters.stock === '1' ? { gt: 0 } : 0 } : {}),
    };
    const [items, total] = await db.$transaction([
      db.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      db.product.count({ where }),
    ]);
    return NextResponse.json({
      items: items.map(serializeProduct),
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
    const data = productSchema.parse(await request.json());
    return NextResponse.json(await saveProduct(data), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
