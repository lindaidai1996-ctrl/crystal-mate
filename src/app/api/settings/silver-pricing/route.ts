import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { getSilverPricing, saveSilverPricing } from '@/lib/silver-pricing';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getSilverPricing());
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await saveSilverPricing(await request.json()));
  } catch (error) {
    return apiError(error);
  }
}
