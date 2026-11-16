import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { listSchema, productSchema } from '@/lib/validation';
import { productInclude, saveProduct, serializeProduct } from '@/lib/products';
import { Prisma } from '@prisma/client';
import { productListWhere } from '@/lib/catalog-list-filters';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const filters = listSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const where = await productListWhere(filters);
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = filters.sortPrice
      ? [{ priceCents: filters.sortPrice }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [items, total] = await db.$transaction([
      db.product.findMany({
        where,
        include: productInclude,
        orderBy,
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

async function handlePOST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = productSchema.parse(await request.json());
    return NextResponse.json(await saveProduct(data), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
