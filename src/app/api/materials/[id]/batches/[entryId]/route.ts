import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialBatchEntryUpdateSchema } from '@/lib/validation';
import { entryInclude, serializeEntry, updateMaterialEntry } from '@/lib/materials';

type Context = { params: Promise<{ id: string; entryId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id, entryId } = await params;
    const entry = await db.materialBatchEntry.findUnique({
      where: { id: entryId },
      include: entryInclude,
    });
    if (!entry || entry.materialId !== id) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(serializeEntry(entry));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id, entryId } = await params;
    return NextResponse.json(
      await updateMaterialEntry(
        id,
        entryId,
        materialBatchEntryUpdateSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id, entryId } = await params;
    const entry = await db.materialBatchEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.materialId !== id) throw new ApiError(404, 'NOT_FOUND');
    await db.materialBatchEntry.delete({ where: { id: entryId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
