import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { materialListSchema } from '@/lib/validation';
import { materialListWhere } from '@/lib/catalog-list-filters';
import { summarizeCategoryCounts } from '@/lib/category-counts';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const params = new URLSearchParams(request.nextUrl.searchParams);
    params.delete('categoryId');
    const filters = materialListSchema.parse(Object.fromEntries(params));
    const categories = await db.materialCategory.findMany({
      select: { id: true, name: true, parentId: true },
    });
    const where = await materialListWhere(filters, categories);
    const groups = await db.material.groupBy({
      by: ['categoryId'],
      where,
      _count: { _all: true },
    });
    return NextResponse.json(summarizeCategoryCounts(groups, categories));
  } catch (error) {
    return apiError(error);
  }
}
