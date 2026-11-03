import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { db } from '@/lib/db';
import { imageRecognitionModels } from '@/lib/ai/imageRecognition';
import { createImportSchema } from '@/lib/materialImageImport/contracts';
import { createImageImport } from '@/lib/materialImageImport/store';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const items = await db.materialImageImport.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        status: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    });
    return NextResponse.json({ items, models: imageRecognitionModels() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await createImageImport(createImportSchema.parse(await request.json())),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
