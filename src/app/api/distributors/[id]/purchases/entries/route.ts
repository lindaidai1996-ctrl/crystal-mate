import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import {
  distributorIdSchema,
  distributorEntryQuerySchema,
  getDistributorPurchaseEntries,
} from '@/lib/distributor-purchases';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = distributorIdSchema.parse((await params).id);
    const query = distributorEntryQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await getDistributorPurchaseEntries(id, query));
  } catch (error) {
    return apiError(error);
  }
}
