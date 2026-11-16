import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { reserveProductCode } from '@/lib/product-code-store';

const codeRequestSchema = z.object({ categoryId: z.string().cuid() });

async function handlePOST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { categoryId } = codeRequestSchema.parse(await request.json());
    return NextResponse.json(await reserveProductCode(categoryId));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
