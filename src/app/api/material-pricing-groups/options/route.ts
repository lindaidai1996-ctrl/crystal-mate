import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { listPricingOptions } from '@/lib/material-pricing/service';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await listPricingOptions(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
