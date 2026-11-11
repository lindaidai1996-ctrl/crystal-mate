import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { listSchema } from '@/lib/validation';
import { productListWhere } from '@/lib/catalog-list-filters';
import { summarizeCategoryCounts } from '@/lib/category-counts';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const params = new URLSearchParams(request.nextUrl.searchParams);
    params.delete('categoryId');
    const filters = listSchema.parse(Object.fromEntries(params));
    const where = await productListWhere(filters);
    const groups = await db.product.groupBy({
      by: ['categoryId'],
      where,
      _count: { _all: true },
    });
    return NextResponse.json(summarizeCategoryCounts(groups));
  } catch (error) {
    return apiError(error);
  }
}
