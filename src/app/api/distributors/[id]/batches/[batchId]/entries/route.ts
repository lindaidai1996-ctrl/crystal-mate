import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { distributorIdSchema } from '@/lib/distributor-purchases';
import { getDistributorBatchEntries, distributorBatchPagination } from '@/lib/distributor-batches';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  try {
    await requireAdmin(request);
    const path = await params;
    const id = distributorIdSchema.parse(path.id);
    const batchId = distributorIdSchema.parse(path.batchId);
    const query = distributorBatchPagination.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await getDistributorBatchEntries(id, batchId, query));
  } catch (error) {
    return apiError(error);
  }
}
