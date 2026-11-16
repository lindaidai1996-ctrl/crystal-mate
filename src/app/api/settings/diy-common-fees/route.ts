import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { getDiyCommonFees, saveDiyCommonFees } from '@/lib/diy-common-fee-settings';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getDiyCommonFees());
  } catch (error) {
    return apiError(error);
  }
}

async function handlePUT(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await saveDiyCommonFees(await request.json()));
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = withAuditRoute(handlePUT);
