import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { previewSchemeChange } from '@/lib/price-schemes/service';
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await previewSchemeChange(await request.json()));
  } catch (error) {
    return apiError(error);
  }
}
