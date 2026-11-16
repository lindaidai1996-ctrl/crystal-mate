import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { diyRecognizeSchema } from '@/lib/diyImageImport/contracts';
import { recognizeDiyImport } from '@/lib/diyImageImport/store';

export const maxDuration = 240;
async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await recognizeDiyImport(
        (await context.params).id,
        diyRecognizeSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
