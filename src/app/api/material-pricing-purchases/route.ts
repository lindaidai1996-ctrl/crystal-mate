import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { listProcurement, saveProcurement } from '@/lib/material-pricing/purchase-service';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await listProcurement(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    await requireAdmin(request);
    return NextResponse.json(await saveProcurement(await request.json()), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
});
