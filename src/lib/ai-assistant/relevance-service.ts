import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { readAssistantRecall } from './recall-data';
import { RelevanceRuns } from './relevance-runs';
import { judgeAssistantRelevance } from './relevance-model';
const runs = new RelevanceRuns();
export async function startAssistantRelevance(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.start(account.id, input, (query) =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        return readAssistantRecall(tx, query);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    ),
  );
}
export async function continueAssistantRelevance(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.advance(account.id, input, judgeAssistantRelevance);
}
export async function cancelAssistantRelevance(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.cancel(account.id, input);
}
export async function readAssistantRelevance(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.read(account.id, input);
}
