import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { materialImageImportSources } from '@/lib/materialImageImport/materialSources';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await materialImageImportSources((await params).id));
  } catch (error) {
    return apiError(error);
  }
}
