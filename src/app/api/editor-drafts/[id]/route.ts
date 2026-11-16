import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiError, requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { draftInput, draftJson, extendDraftImages } from '@/lib/editor-drafts';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await requireAccount(request);
    const { id } = await context.params;
    const draft = await db.editorDraft.findFirst({ where: { id, ownerId: actor.id } });
    if (!draft) throw new ApiError(404, 'NOT_FOUND');
    await extendDraftImages(draft.data as Record<string, unknown>);
    return NextResponse.json(draft);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePUT(request: NextRequest, context: Context) {
  try {
    const actor = await requireAccount(request);
    const { id } = await context.params;
    const input = draftInput.parse(await request.json());
    if (JSON.stringify(input.data).length > 200_000) throw new ApiError(400, 'INVALID_INPUT');
    await extendDraftImages(input.data);
    const updated = await db.editorDraft.updateMany({
      where: { id, kind: input.kind, ownerId: actor.id },
      data: { ...input, data: draftJson(input.data) },
    });
    if (!updated.count) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(await db.editorDraft.findUniqueOrThrow({ where: { id } }));
  } catch (error) {
    return apiError(error);
  }
}

async function handleDELETE(request: NextRequest, context: Context) {
  try {
    const actor = await requireAccount(request);
    const { id } = await context.params;
    const removed = await db.editorDraft.deleteMany({ where: { id, ownerId: actor.id } });
    if (!removed.count) throw new ApiError(404, 'NOT_FOUND');
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = withAuditRoute(handlePUT);
export const DELETE = withAuditRoute(handleDELETE);
