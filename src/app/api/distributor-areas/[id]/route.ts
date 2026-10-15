import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { distributorAreaSchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const data = distributorAreaSchema.parse(await request.json());
    const area = await db.$transaction(async (tx) => {
      const current = await tx.distributorArea.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, 'NOT_FOUND');
      const updated = await tx.distributorArea.update({ where: { id }, data });
      if (current.name !== data.name) {
        await tx.distributor.updateMany({
          where: { area: current.name },
          data: { area: data.name },
        });
      }
      return updated;
    });
    return NextResponse.json(area);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    await db.$transaction(async (tx) => {
      const area = await tx.distributorArea.findUnique({ where: { id } });
      if (!area) throw new ApiError(404, 'NOT_FOUND');
      if (await tx.distributor.count({ where: { area: area.name } }))
        throw new ApiError(409, 'DISTRIBUTOR_AREA_IN_USE');
      await tx.distributorArea.delete({ where: { id } });
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
