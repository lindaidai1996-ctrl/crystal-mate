import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAccount } from '@/lib/api';
import { pickerFiltersSchema } from '@/lib/diy-picker/contracts';
import { listPickerMaterials } from '@/lib/diy-picker/query';

export async function GET(request: NextRequest) {
  try {
    const account = await requireAccount(request);
    const filters = pickerFiltersSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listPickerMaterials(account.id, filters), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
