import { withAuditRoute } from '@/lib/audit-route';
import { compare, hash } from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { passwordSchema } from '@/lib/account';

async function handlePOST(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const input = passwordSchema.parse(await request.json());
    const admin = await db.admin.findUnique({ where: { username: session.user!.name! } });
    if (!admin) throw new ApiError(401, 'UNAUTHORIZED');
    if (!(await compare(input.currentPassword, admin.passwordHash)))
      throw new ApiError(400, 'CURRENT_PASSWORD_INCORRECT');
    if (await compare(input.newPassword, admin.passwordHash))
      throw new ApiError(400, 'PASSWORD_UNCHANGED');
    const passwordHash = await hash(input.newPassword, 12);
    const updated = await db.admin.updateMany({
      where: { id: admin.id, passwordHash: admin.passwordHash },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ApiError(409, 'UNAUTHORIZED');
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withAuditRoute(handlePOST);
