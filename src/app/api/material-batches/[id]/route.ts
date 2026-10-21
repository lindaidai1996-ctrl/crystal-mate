import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { entryInclude, serializeEntry } from '@/lib/materials';
import { updateBatch } from '@/lib/material-batches';
import { materialBatchWriteSchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const batch = await db.materialBatch.findUnique({
      where: { id: (await params).id },
      include: {
        attachments: { orderBy: { position: 'asc' } },
        entries: { include: { ...entryInclude, material: true }, orderBy: { createdAt: 'desc' } },
        productEntries: {
          include: {
            product: {
              select: {
                id: true,
                code: true,
                name: true,
                priceCents: true,
                images: { orderBy: { position: 'asc' } },
              },
            },
            distributor: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!batch) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json({
      ...batch,
      entries: batch.entries.map((entry) => ({
        ...serializeEntry(entry),
        material: entry.material,
      })),
      productEntries: batch.productEntries.map((entry) => ({
        ...entry,
        unitCost: entry.unitCost.toFixed(2),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await updateBatch((await params).id, materialBatchWriteSchema.parse(await request.json())),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    if (
      (await db.materialBatchEntry.count({ where: { batchId: id } })) ||
      (await db.productPurchaseEntry.count({ where: { batchId: id } }))
    )
      throw new ApiError(409, 'MATERIAL_BATCH_IN_USE');
    await db.materialBatch.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
