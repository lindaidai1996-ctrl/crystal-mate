import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api';
import { materialBulkDeleteSchema, materialBulkUpdateSchema } from '@/lib/material-bulk';
import {
  deleteMaterialBulk,
  materialBulkError,
  updateMaterialBulk,
} from '@/lib/material-bulk-service';

async function handlePATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await updateMaterialBulk(materialBulkUpdateSchema.parse(await request.json())),
    );
  } catch (error) {
    return materialBulkError(error);
  }
}

async function handleDELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const input = materialBulkDeleteSchema.parse(await request.json());
    return NextResponse.json(await deleteMaterialBulk(input.snapshot));
  } catch (error) {
    return materialBulkError(error);
  }
}

export const PATCH = withAuditRoute(handlePATCH);
export const DELETE = withAuditRoute(handleDELETE);
