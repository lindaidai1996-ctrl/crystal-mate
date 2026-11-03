import { NextRequest, NextResponse } from 'next/server';
import { apiError, requireAdmin } from '@/lib/api';
import { diySaveSchema, diyVersionSchema } from '@/lib/diyImageImport/contracts';
import { deleteDiyImport, getDiyImport, saveDiyImport } from '@/lib/diyImageImport/store';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await getDiyImport((await context.params).id));
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      await saveDiyImport((await context.params).id, diySaveSchema.parse(await request.json())),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: NextRequest, context: Context) {
  try {
    await requireAdmin(request);
    const { version } = diyVersionSchema.parse(await request.json());
    await deleteDiyImport((await context.params).id, version);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
