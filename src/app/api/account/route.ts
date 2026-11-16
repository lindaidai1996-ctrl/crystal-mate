import { withAuditRoute } from '@/lib/audit-route';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, ApiError, requireAdmin } from '@/lib/api';
import { profileSchema, profileSelect } from '@/lib/account';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const profile = await db.admin.findUnique({
      where: { username: session.user!.name! },
      select: profileSelect,
    });
    if (!profile) throw new ApiError(401, 'UNAUTHORIZED');
    return NextResponse.json(profile, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

async function handlePATCH(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const input = profileSchema.parse(await request.json());
    const profile = await db.$transaction(async (tx) => {
      const admin = await tx.admin.findUnique({ where: { username: session.user!.name! } });
      if (!admin) throw new ApiError(401, 'UNAUTHORIZED');
      let avatarUrl: string | null | undefined = input.avatarObjectKey === null ? null : undefined;
      if (input.avatarObjectKey && input.avatarObjectKey !== admin.avatarObjectKey) {
        const where = {
          objectKey: input.avatarObjectKey,
          uploadedAt: { not: null },
          usedAt: null,
          expiresAt: { gt: new Date() },
        };
        const grant = await tx.uploadGrant.findFirst({ where });
        if (!grant) throw new ApiError(400, 'INVALID_IMAGE');
        const consumed = await tx.uploadGrant.updateMany({ where, data: { usedAt: new Date() } });
        if (consumed.count !== 1) throw new ApiError(400, 'INVALID_IMAGE');
        avatarUrl = grant.url;
      }
      return tx.admin.update({
        where: { id: admin.id },
        data: { ...input, avatarUrl },
        select: profileSelect,
      });
    });
    return NextResponse.json(profile);
  } catch (error) {
    return apiError(error);
  }
}

export const PATCH = withAuditRoute(handlePATCH);
