import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { commitImportSchema } from '@/lib/materialImageImport/contracts';
import { commitImageImportItem } from '@/lib/materialImageImport/store';

export const maxDuration = 120;
async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await commitImageImportItem(
        (await context.params).id,
        commitImportSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
