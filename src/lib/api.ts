import { auth } from '@/auth';
import { auditContext } from './audit-context';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function requireAdmin(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.name) throw new ApiError(401, 'UNAUTHORIZED');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') ?? request.nextUrl.host;
    if (origin && new URL(origin).host !== host) throw new ApiError(403, 'INVALID_ORIGIN');
  }
  const context = auditContext.getStore();
  if (context && !context.actor) {
    if (!session.user.id) throw new ApiError(401, 'UNAUTHORIZED');
    context.actor = {
      id: session.user.id,
      username: session.user.name,
      nickname: session.user.nickname ?? '',
    };
  }
  return session;
}

export function apiError(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json({ error: error.code }, { status: error.status });
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  if (error instanceof ZodError)
    return NextResponse.json({ error: 'INVALID_INPUT', issues: error.issues }, { status: 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const model = error.meta?.modelName;
      const code =
        model === 'MaterialBatch'
          ? 'MATERIAL_BATCH_NAME_EXISTS'
          : model === 'MaterialBatchEntry'
            ? 'MATERIAL_ALREADY_IN_BATCH'
            : 'DUPLICATE';
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (error.code === 'P2003') return NextResponse.json({ error: 'IN_USE' }, { status: 409 });
    if (error.code === 'P2025') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  console.error(error);
  return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 });
}

export async function requireAccount(request: NextRequest) {
  const session = await requireAdmin(request);
  if (!session.user?.id || !session.user.name) throw new ApiError(401, 'UNAUTHORIZED');
  return {
    id: session.user.id,
    username: session.user.name,
    nickname: session.user.nickname ?? '',
  };
}
