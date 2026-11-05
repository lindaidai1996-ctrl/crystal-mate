import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { draftInput, draftJson, draftKind, extendDraftImages } from '@/lib/editor-drafts';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const kind = draftKind.parse(request.nextUrl.searchParams.get('kind'));
    const items = await db.editorDraft.findMany({
      where: { kind },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, kind: true, title: true, updatedAt: true },
    });
    return NextResponse.json(items);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const input = draftInput.parse(await request.json());
    if (JSON.stringify(input.data).length > 200_000)
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    await extendDraftImages(input.data);
    const draft = await db.editorDraft.create({
      data: { ...input, data: draftJson(input.data) },
    });
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
