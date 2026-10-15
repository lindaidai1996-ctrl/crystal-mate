import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { materialMasterSchema } from '@/lib/validation';
import { materialInclude, updateMaterialMaster, serializeMaterial } from '@/lib/materials';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const material = await db.material.findUnique({
      where: { id: (await params).id },
      include: materialInclude,
    });
    if (!material) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(serializeMaterial(material));
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await updateMaterialMaster(
        (await params).id,
        materialMasterSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    if (await db.materialBatchEntry.count({ where: { materialId: id } }))
      throw new ApiError(409, 'MATERIAL_IN_USE');
    await db.material.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
