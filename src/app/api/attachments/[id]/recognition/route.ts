import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAccount } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import { ownerSchema } from '@/lib/shared-attachment-contracts';
import { imageRecognitionModels } from '@/lib/ai/imageRecognition';
import {
  cancelReceiptRecognition,
  getReceiptRecognition,
  recognizeReceipt,
} from '@/lib/attachment-recognition';
export const maxDuration = 120;
const bodySchema = z.strictObject({
  owner: ownerSchema,
  provider: z.enum(['deepseek', 'compatible']),
  requestId: z.uuid(),
  force: z.boolean().default(false),
});
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAccount(request);
    const owner = ownerSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({
      models: imageRecognitionModels(),
      recognition: await getReceiptRecognition((await context.params).id, owner),
    });
  } catch (error) {
    return apiError(error);
  }
}
export const POST = withAuditRoute(async (request: NextRequest, context: Context) => {
  try {
    const account = await requireAccount(request);
    const input = bodySchema.parse(await request.json());
    return NextResponse.json(
      await recognizeReceipt({
        ...input,
        id: (await context.params).id,
        accountId: account.id,
        signal: request.signal,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
});
export const DELETE = withAuditRoute(async (request: NextRequest, context: Context) => {
  try {
    const account = await requireAccount(request);
    const { requestId } = z.strictObject({ requestId: z.uuid() }).parse(await request.json());
    await cancelReceiptRecognition((await context.params).id, requestId, account.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
});
