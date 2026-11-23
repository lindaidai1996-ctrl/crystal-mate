import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { getProcurement, saveProcurement } from '@/lib/material-pricing/purchase-service';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getProcurement((await context.params).id), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
export const PATCH = withAuditRoute(async (request: NextRequest, context: Context) => {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await saveProcurement(await request.json(), (await context.params).id),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
});
