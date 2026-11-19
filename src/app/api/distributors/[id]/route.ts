import { attachmentListInclude } from '@/lib/shared-attachment-query';
import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { distributorSchema } from '@/lib/validation';
import { updateDistributor } from '@/lib/distributors';
import { getDistributorStats } from '@/lib/distributor-batches';
import { distributorIdSchema } from '@/lib/distributor-purchases';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = distributorIdSchema.parse((await params).id);
    const [item, areas] = await Promise.all([
      db.distributor.findUnique({
        where: { id },
        include: {
          attachments: attachmentListInclude,
          _count: { select: { attachments: true } },
        },
      }),
      db.distributorArea.findMany({ orderBy: { name: 'asc' }, select: { name: true } }),
    ]);
    if (!item) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json({
      item,
      areas: areas.map((area) => area.name),
      stats: await getDistributorStats(id),
    });
  } catch (error) {
    return apiError(error);
  }
}

async function handlePUT(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const data = distributorSchema.parse(await request.json());
    const { id } = await params;
    const item = await updateDistributor(id, data);
    return NextResponse.json(item);
  } catch (error) {
    return apiError(error);
  }
}

async function handleDELETE(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = (await params).id;
    if (
      (await db.materialBatchEntry.count({ where: { distributorId: id } })) ||
      (await db.productPurchaseEntry.count({ where: { distributorId: id } }))
    )
      throw new ApiError(409, 'DISTRIBUTOR_IN_USE');
    await db.distributor.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = withAuditRoute(handlePUT);
export const DELETE = withAuditRoute(handleDELETE);
