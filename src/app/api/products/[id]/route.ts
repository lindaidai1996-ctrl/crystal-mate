import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { productSchema } from '@/lib/validation';
import { productInclude, saveProduct, serializeProduct } from '@/lib/products';
import { Prisma } from '@prisma/client';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const product = await db.product.findUnique({
      where: { id: (await params).id },
      include: productInclude,
    });
    if (!product) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(serializeProduct(product));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const data = productSchema.parse(await request.json());
    return NextResponse.json(await saveProduct(data, (await params).id));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    await db.$transaction(
      async (tx) => {
        await tx.productDiyRun.deleteMany({ where: { productId: id } });
        await tx.productPurchaseEntry.deleteMany({ where: { productId: id } });
        await tx.productStockAdjustment.deleteMany({ where: { productId: id } });
        await tx.product.delete({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
