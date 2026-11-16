import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { readAssistantCandidates } from './candidate-data';
import { CandidateRuns } from './candidate-runs';

const runs = new CandidateRuns();

export async function queryAssistantCandidates(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.query(account.id, input, (query) =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
        return readAssistantCandidates(tx, query);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
    ),
  );
}

export async function getAssistantCandidateDetails(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return runs.details(account.id, input);
}
