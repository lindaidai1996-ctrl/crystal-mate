import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { comparisonQuerySchema } from '@/lib/batch-comparison';
import { getBatchComparison } from '@/lib/batch-comparison-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const query = comparisonQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await getBatchComparison('product', (await params).id, query));
  } catch (error) {
    return apiError(error);
  }
}
