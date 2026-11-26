import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await db.priceScheme.findMany({
        orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        include: { _count: { select: { prices: true } } },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
