import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { getSilverImport, updateSilverImport } from '@/lib/material-pricing-import/store';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getSilverImport((await context.params).id), {
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
      await updateSilverImport((await context.params).id, await request.json()),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
});
