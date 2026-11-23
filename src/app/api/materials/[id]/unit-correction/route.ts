import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { unitCorrectionPreviewSchema, unitCorrectionSchema } from '@/lib/material-unit-correction';
import { correctMaterialUnit, previewUnitCorrection } from '@/lib/material-unit-correction-service';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const input = unitCorrectionPreviewSchema.parse(await request.json());
    return NextResponse.json(
      await previewUnitCorrection((await params).id, input.unit, input.edits),
    );
  } catch (error) {
    return apiError(error);
  }
}

async function handlePATCH(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const input = unitCorrectionSchema.parse(await request.json());
    return NextResponse.json(
      await correctMaterialUnit((await params).id, input.unit, input.snapshot, input.edits),
    );
  } catch (error) {
    return apiError(error);
  }
}

export const PATCH = withAuditRoute(handlePATCH);
