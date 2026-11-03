import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { diyVersionSchema } from '@/lib/diyImageImport/contracts';
import { commitDiyImport } from '@/lib/diyImageImport/commit';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { version } = diyVersionSchema.parse(await request.json());
    return NextResponse.json(await commitDiyImport((await context.params).id, version));
  } catch (error) {
    return apiError(error);
  }
}
