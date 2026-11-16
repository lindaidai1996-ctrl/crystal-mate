import { withAuditRoute } from '@/lib/audit-route';
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
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        sourceUrl: true,
        status: true,
        archivedAt: true,
        createdAt: true,
        _count: { select: { items: true } },
        items: { where: { entryId: { not: null } }, select: { id: true } },
      },
    });
    return NextResponse.json({
      items: items.map(({ items: committed, ...item }) => ({
        ...item,
        importedCount: committed.length,
      })),
      models: imageRecognitionModels(),
    });
  } catch (error) {
    return apiError(error);
  }
}

async function handlePOST(request: NextRequest) {
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

export const POST = withAuditRoute(handlePOST);
