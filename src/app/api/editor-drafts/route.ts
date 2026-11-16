import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { draftInput, draftJson, draftKind, extendDraftImages } from '@/lib/editor-drafts';

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAccount(request);
    const kind = draftKind.parse(request.nextUrl.searchParams.get('kind'));
    const items = await db.editorDraft.findMany({
      where: {
        kind,
        ownerId: request.nextUrl.searchParams.get('scope') === 'legacy' ? null : actor.id,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, kind: true, title: true, updatedAt: true },
    });
    return NextResponse.json(items);
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const actor = await requireAccount(request);
    const input = draftInput.parse(await request.json());
    if (JSON.stringify(input.data).length > 200_000)
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    await extendDraftImages(input.data);
    const draft = await db.editorDraft.create({
      data: { ...input, ownerId: actor.id, data: draftJson(input.data) },
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
