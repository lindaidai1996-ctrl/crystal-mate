import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { draftInput, draftJson, extendDraftImages } from '@/lib/editor-drafts';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    const draft = await db.editorDraft.findUnique({ where: { id } });
    if (!draft) throw new ApiError(404, 'NOT_FOUND');
    await extendDraftImages(draft.data as Record<string, unknown>);
    return NextResponse.json(draft);
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    const input = draftInput.parse(await request.json());
    if (JSON.stringify(input.data).length > 200_000) throw new ApiError(400, 'INVALID_INPUT');
    await extendDraftImages(input.data);
    const updated = await db.editorDraft.updateMany({
      where: { id, kind: input.kind },
      data: { ...input, data: draftJson(input.data) },
    });
    if (!updated.count) throw new ApiError(404, 'NOT_FOUND');
    return NextResponse.json(await db.editorDraft.findUniqueOrThrow({ where: { id } }));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    await db.editorDraft.delete({ where: { id } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
