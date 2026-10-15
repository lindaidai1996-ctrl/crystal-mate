import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialBatchEntrySchema } from '@/lib/validation';
import { createMaterialEntry, entryInclude, serializeEntry } from '@/lib/materials';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    if (!(await db.material.findUnique({ where: { id }, select: { id: true } })))
      throw new ApiError(404, 'NOT_FOUND');
    const entries = await db.materialBatchEntry.findMany({
      where: { materialId: id },
      include: entryInclude,
    });
    return NextResponse.json(entries.map(serializeEntry));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await createMaterialEntry(
        (await params).id,
        materialBatchEntrySchema.parse(await request.json()),
      ),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
