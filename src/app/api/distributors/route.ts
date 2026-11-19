import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, requireAdmin } from '@/lib/api';
import { distributorInclude, createDistributor } from '@/lib/distributors';
import { getDistributorBatchStats } from '@/lib/distributor-batches';
import { getDistributorItemCounts } from '@/lib/distributor-purchases';
import { distributorSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const [items, areas, areaCounts, itemCounts, batchStats] = await Promise.all([
      db.distributor.findMany({
        include: distributorInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      db.distributorArea.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.distributor.groupBy({ by: ['area'], _count: { _all: true } }),
      getDistributorItemCounts(),
      getDistributorBatchStats(),
    ]);
    const counts = new Map(areaCounts.map(({ area, _count }) => [area, _count._all]));
    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        ...(batchStats.get(item.id) ?? { batchCount: 0, latestReceivedAt: null }),
        itemCounts: itemCounts.get(item.id) ?? { total: 0, products: 0, materials: 0 },
      })),
      areas: areas.map((area) => area.name),
      areaItems: areas.map((area) => ({
        ...area,
        distributorCount: counts.get(area.name) ?? 0,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const data = distributorSchema.parse(await request.json());
    const item = await createDistributor(data);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
