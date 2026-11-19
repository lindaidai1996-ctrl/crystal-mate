import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { distributorIdSchema } from '@/lib/distributor-purchases';
import { getDistributorBatches, distributorBatchQuery } from '@/lib/distributor-batches';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const path = await params;
    const id = distributorIdSchema.parse(path.id);

    const query = distributorBatchQuery.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await getDistributorBatches(id, query));
  } catch (error) {
    return apiError(error);
  }
}
