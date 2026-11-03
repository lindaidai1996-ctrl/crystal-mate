import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { imageRecognitionModels } from '@/lib/ai/imageRecognition';
import { diyCreateSchema, diyDataSchema } from '@/lib/diyImageImport/contracts';
import { createDiyImport } from '@/lib/diyImageImport/store';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const items = await db.diyImageImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, data: true, status: true, createdAt: true },
    });
    return NextResponse.json({
      models: imageRecognitionModels(),
      items: items.map(({ data, ...item }) => ({
        ...item,
        name: diyDataSchema.parse(data).name,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await createDiyImport(diyCreateSchema.parse(await request.json())), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
