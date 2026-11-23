import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { listPricingHistory } from '@/lib/material-pricing/service';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(request.nextUrl.searchParams.get('page') ?? 1);
    return NextResponse.json(await listPricingHistory(id, page), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
