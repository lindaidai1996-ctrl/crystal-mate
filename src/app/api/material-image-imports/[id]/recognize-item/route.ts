import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { recognizeImportItemSchema } from '@/lib/materialImageImport/contracts';
import { recognizeImageImportItem } from '@/lib/materialImageImport/itemRecognition';

export const maxDuration = 120;

async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await recognizeImageImportItem(
        (await context.params).id,
        recognizeImportItemSchema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
