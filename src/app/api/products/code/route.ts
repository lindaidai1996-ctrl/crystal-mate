import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { formatProductCode } from '@/lib/product-code';

const codeRequestSchema = z.object({ categoryId: z.string().cuid() });

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { categoryId } = codeRequestSchema.parse(await request.json());
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: { prefix: true },
    });
    if (!category) throw new ApiError(400, 'CATEGORY_NOT_FOUND');
    if (!category.prefix) throw new ApiError(400, 'CATEGORY_PREFIX_MISSING');

    const productCount = await db.product.count({ where: { categoryId } });
    for (let count = productCount; count < 9999; count++) {
      const code = formatProductCode(category.prefix, count);
      const existing = await db.product.findUnique({ where: { code }, select: { id: true } });
      if (!existing) return NextResponse.json({ code });
    }
    throw new ApiError(409, 'CODE_EXHAUSTED');
  } catch (error) {
    return apiError(error);
  }
}
