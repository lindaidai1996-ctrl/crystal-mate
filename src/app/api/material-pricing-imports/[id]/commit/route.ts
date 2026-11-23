import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { commitSilverRow } from '@/lib/material-pricing-import/store';
import { commitSilverImportSchema } from '@/lib/material-pricing-import/contracts';
export const POST = withAuditRoute(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      await requireAdmin(request);
      const input = commitSilverImportSchema.parse(await request.json());
      return NextResponse.json(
        await commitSilverRow((await context.params).id, input.rowNumber, input.version),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      return apiError(error);
    }
  },
);
