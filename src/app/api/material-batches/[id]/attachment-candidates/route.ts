import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import {
  attachmentCandidateQuerySchema,
  attachmentOwnerIdSchema,
  getAttachmentCandidates,
} from '@/lib/attachment-candidates';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    await requireAdmin(request);
    const id = attachmentOwnerIdSchema.parse((await params).id);
    const query = attachmentCandidateQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return NextResponse.json(await getAttachmentCandidates({ type: 'batch', id }, query));
  } catch (error) {
    return apiError(error);
  }
}
