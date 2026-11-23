import { after, NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { auditContext } from '@/lib/audit-context';
import { withAuditRoute } from '@/lib/audit-route';
import { startSilverImport, runSilverImport } from '@/lib/material-pricing-import/store';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const POST = withAuditRoute(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      await requireAdmin(request);
      const id = (await context.params).id;
      const result = await startSilverImport(id, await request.json());
      const audit = auditContext.getStore()!;
      if (result.token) {
        const token = result.token;
        after(() => auditContext.run(audit, () => runSilverImport(id, token)));
      }
      return NextResponse.json(result.job, {
        status: 202,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return apiError(error);
    }
  },
);
