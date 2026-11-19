import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireAdmin } from '@/lib/api';
import { withAuditRoute } from '@/lib/audit-route';
import {
  attachmentCommandSchema,
  commandAttachments,
  attachmentConflicts,
} from '@/lib/shared-attachments';
import { ownerSchema } from '@/lib/shared-attachment-contracts';
import { searchAttachmentTargets } from '@/lib/attachment-targets';
const querySchema = z.object({
  type: z.enum(['batch', 'distributor']),
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  ownerType: z.enum(['batch', 'distributor']).optional(),
  ownerId: z.string().cuid().optional(),
});
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const q = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const owner = q.ownerId && q.ownerType ? { type: q.ownerType, id: q.ownerId } : undefined;
    return NextResponse.json(await searchAttachmentTargets(q.type, owner, q.q, q.page));
  } catch (error) {
    return apiError(error);
  }
}
export const POST = withAuditRoute(async (request: NextRequest) => {
  try {
    await requireAdmin(request);
    const raw = await request.json();
    if (raw.operation === 'conflicts') {
      const input = z
        .strictObject({
          operation: z.literal('conflicts'),
          ids: z.array(z.string().min(1).max(150)).min(1).max(50),
          targets: z.array(ownerSchema).min(1).max(50),
        })
        .parse(raw);
      return NextResponse.json(await attachmentConflicts(input.ids, input.targets));
    }
    return NextResponse.json(await commandAttachments(attachmentCommandSchema.parse(raw)));
  } catch (error) {
    return apiError(error);
  }
});
