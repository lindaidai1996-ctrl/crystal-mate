import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { marketingToggleSchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { field, value } = marketingToggleSchema.parse(await request.json());
    const id = (await params).id;
    const result = await db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id },
        select: { category: { select: { name: true } } },
      });
      if (!product) throw new ApiError(404, 'NOT_FOUND');
      if (product.category.name !== '蛋面') throw new ApiError(400, 'INVALID_INPUT');

      const marketing = await tx.productMarketing.upsert({
        where: { productId: id },
        create: { productId: id, [field]: value },
        update: { [field]: value },
      });
      const updated = await tx.product.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { updatedAt: true },
      });
      return { value: marketing[field], updatedAt: updated.updatedAt };
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
