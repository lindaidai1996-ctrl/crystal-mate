import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { commitSchemeChange } from '@/lib/price-schemes/service';
async function commit(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await commitSchemeChange(await request.json()));
  } catch (error) {
    return apiError(error);
  }
}
export const POST = withAuditRoute(commit);
