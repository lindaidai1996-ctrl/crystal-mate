import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { productQuickEditSchema, productSchema } from '@/lib/validation';
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

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const input = productQuickEditSchema.parse(await request.json());
    const id = (await params).id;

    if (input.field === 'price') {
      const product = await db.product.update({
        where: { id },
        data: { priceCents: input.priceCents, saleManual: true },
        select: { priceCents: true, updatedAt: true },
      });
      return NextResponse.json(product);
    }

    const result = await db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id },
        select: { category: { select: { name: true } } },
      });
      if (!product) throw new ApiError(404, 'NOT_FOUND');
      if (product.category.name !== '蛋面') throw new ApiError(400, 'INVALID_INPUT');

      const measurement = input.measurement
        ? {
            lengthMm: input.measurement.lengthMm ?? null,
            widthMm: input.measurement.widthMm ?? null,
            heightMm: input.measurement.heightMm ?? null,
          }
        : null;
      if (!measurement || Object.values(measurement).every((value) => value === null)) {
        await tx.cabochonMeasurement.deleteMany({ where: { productId: id } });
      } else {
        await tx.cabochonMeasurement.upsert({
          where: { productId: id },
          create: { productId: id, ...measurement },
          update: measurement,
        });
      }
      const updated = await tx.product.update({
        where: { id },
        data: { updatedAt: new Date() },
        select: { updatedAt: true },
      });
      return { measurement, updatedAt: updated.updatedAt };
    });
    return NextResponse.json(result);
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
