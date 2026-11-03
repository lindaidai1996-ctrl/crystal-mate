import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { nameTagRequestSchema } from '@/lib/name-tag-matching';
import { recognizeNameTags } from '@/lib/ai/nameTagRecognition';

export const maxDuration = 90;
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { names } = nameTagRequestSchema.parse(await request.json());
    const tags = await db.tag.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ matches: await recognizeNameTags(names, tags) });
  } catch (error) {
    return apiError(error);
  }
}
