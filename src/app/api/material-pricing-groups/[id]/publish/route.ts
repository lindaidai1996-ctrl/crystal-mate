import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { publishPricingGroup } from '@/lib/material-pricing/service';

export const POST = withAuditRoute(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      await requireAdmin(request);
      const { id } = await context.params;
      return NextResponse.json(await publishPricingGroup(id, await request.json()), {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return apiError(error);
    }
  },
);
