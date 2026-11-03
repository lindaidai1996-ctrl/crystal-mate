import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { materialBulkPreviewSchema } from '@/lib/material-bulk';
import { materialBulkError, previewMaterialBulk } from '@/lib/material-bulk-service';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const input = materialBulkPreviewSchema.parse(await request.json());
    return NextResponse.json(await previewMaterialBulk(input.materialIds));
  } catch (error) {
    return materialBulkError(error);
  }
}
