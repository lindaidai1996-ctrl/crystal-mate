import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { getPricingPreview } from '@/lib/material-pricing/service';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    return NextResponse.json(await getPricingPreview(id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
