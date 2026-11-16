import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiError, requireAccount } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { db } from '@/lib/db';

async function claim(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAccount(request);
    const { id } = await context.params;
    const result = await db.editorDraft.updateMany({
      where: { id, ownerId: null },
      data: { ownerId: actor.id },
    });
    if (!result.count) throw new ApiError(409, 'DRAFT_ALREADY_CLAIMED');
    return NextResponse.json({ id });
  } catch (error) {
    return apiError(error);
  }
}
export const POST = withAuditRoute(claim);
