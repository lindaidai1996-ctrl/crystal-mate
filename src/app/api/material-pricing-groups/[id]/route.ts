import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { savePricingGroup } from '@/lib/material-pricing/service';

export const PATCH = withAuditRoute(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      await requireAdmin(request);
      const { id } = await context.params;
      return NextResponse.json(await savePricingGroup(await request.json(), id), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return apiError(error);
    }
  },
);
