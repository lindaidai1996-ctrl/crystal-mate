import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { requireAccount } from '@/lib/api';
import { db } from '@/lib/db';
import { CandidateQueryError } from './candidate-contracts';
import { AssistantConversationStore, minimizeAssistantText } from './conversation-store';
import { newAssistantExecution, runAssistantLoop } from './orchestrator';
import { createAssistantToolModel } from './orchestration-model';
import { createAssistantFacts } from './orchestration-facts';
import { readAssistantRecall } from './recall-data';
import { readAssistantPurchases } from './purchase-data';
import { readAssistantStock } from './stock-data';
import { judgeAssistantRelevance } from './relevance-model';
import { orchestrationBudgetSchema } from './orchestration-contracts';
import { executionBudgetSchema } from './relevance-contracts';
import { assistantBrowserView } from './browser-view';
import { readAssistantDisplay } from './display-data';
import { assistantFeedbackSchema } from './feedback-contracts';
import { validateAssistantFeedbackTarget } from './feedback-target';
import { resolveLocationRows } from './reference-resolution';
import { REFERENCE_SCAN_LIMIT } from './reference-contracts';

const identity = z.strictObject({ conversationId: z.uuid() });
const rename = identity.extend({ title: z.string().trim().min(1).max(80) });
const command = identity.extend({ revision: z.number().int().nonnegative() });
export const conversationCommandSchema = z.discriminatedUnion('action', [
  command.extend({
    action: z.literal('message'),
    text: z.string().trim().min(1).max(4000),
    budget: orchestrationBudgetSchema.optional(),
    relevanceBudget: executionBudgetSchema.optional(),
  }),
  command.extend({
    action: z.literal('continue'),
    budget: orchestrationBudgetSchema.optional(),
    relevanceBudget: executionBudgetSchema.optional(),
  }),
  command.extend({
    action: z.literal('retry'),
    budget: orchestrationBudgetSchema.optional(),
    relevanceBudget: executionBudgetSchema.optional(),
  }),
  command.extend({ action: z.literal('cancel') }),
]);
const store = new AssistantConversationStore(db);
export async function saveAssistantConversationFeedback(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  const feedback = assistantFeedbackSchema.parse(input);
  // Ownership is verified before looking up a business target.
  await store.read(account.id, feedback.conversationId);
  await readOnly((tx) => validateAssistantFeedbackTarget(tx, feedback.target));
  return store.feedback(account.id, feedback);
}
export async function listAssistantConversations(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  const { cursor } = z.strictObject({ cursor: z.uuid().optional() }).parse(input);
  const result = await store.list(account.id, cursor);
  const privacy = request.headers.get('x-assistant-privacy') !== 'off';
  return {
    ...result,
    items: result.items.map((row) => ({ ...row, title: privacy ? null : row.title })),
  };
}
export async function renameAssistantConversation(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  const { conversationId, title } = rename.parse(input);
  await store.rename(account.id, conversationId, title);
  return { id: conversationId };
}
export async function deleteAssistantConversation(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  const { conversationId } = identity.parse(input);
  await store.remove(account.id, conversationId);
  return { id: conversationId };
}
export async function readAssistantBrowserConversation(request: NextRequest, input: unknown) {
  const source = await readAssistantConversation(request, input);
  return assistantBrowserView(source, request.headers.get('x-assistant-privacy') !== 'off');
}
async function readOnly<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
      return operation(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 },
  );
}
export async function createAssistantConversation(request: NextRequest) {
  const account = await requireAccount(request);
  return store.create(account.id);
}
export async function readAssistantConversation(request: NextRequest, input: unknown) {
  const account = await requireAccount(request);
  return store.read(account.id, identity.parse(input).conversationId);
}
export async function commandAssistantConversation(request: NextRequest, input: unknown) {
  const account = await requireAccount(request); // Never accept account IDs from input/model.
  const cmd = conversationCommandSchema.parse(input);
  if (cmd.action === 'cancel') return store.cancel(account.id, cmd.conversationId, cmd.revision);
  const current = await store.read(account.id, cmd.conversationId);
  if (current.session.revision !== cmd.revision) throw new CandidateQueryError('STALE_REVISION');
  const previous = current.latest;
  if (
    cmd.action !== 'message' &&
    (!previous || ['completed', 'no_results', 'needs_confirmation'].includes(previous.data.status))
  )
    throw new CandidateQueryError('EXECUTION_NOT_RESUMABLE');
  const execution =
    cmd.action === 'message'
      ? newAssistantExecution(current.session.state)
      : structuredClone(previous!.data);
  const text = cmd.action === 'message' ? minimizeAssistantText(cmd.text) : previous!.text;
  if (cmd.action === 'message' && previous?.data.status === 'needs_confirmation') {
    execution.clarificationContext = {
      text: previous.text,
      clarification: previous.data.clarification,
      pendingPlan: previous.data.pendingPlan,
    };
  }
  if (cmd.action !== 'message') {
    execution.metadata = newAssistantExecution(execution.state).metadata;
    // Every resume reads current facts again; persisted evidence decisions are reused only
    // after P3 checks the entire freshly read source fingerprint. No old process cursor.
    if (execution.phase === 'finish') execution.phase = 'query_facts';
    execution.result = null;
    execution.status = 'running';
    execution.errorCode = null;
  }
  const record = await store.begin(
    account.id,
    cmd.conversationId,
    cmd.revision,
    text,
    execution,
    cmd.action === 'message' ? null : previous!.id,
  );
  // Every business runtime is local to this invocation. Persisted state/checkpoints/CAS
  // make follow-up commands portable across processes; no sticky HTTP routing required.
  const facts = createAssistantFacts({
    accountId: account.id,
    recall: (query) => readOnly((tx) => readAssistantRecall(tx, query)),
    purchases: (query) => readOnly((tx) => readAssistantPurchases(tx, query)),
    stock: (query) => readOnly((tx) => readAssistantStock(tx, query)),
    display: (refs) => readOnly((tx) => readAssistantDisplay(tx, refs)),
    model: judgeAssistantRelevance,
    relevanceBudget: cmd.relevanceBudget,
    location: (input) =>
      readOnly(async (tx) => {
        const rows = await tx.distributor.findMany({
          select: { id: true, name: true, area: true, address: true, notes: true },
          orderBy: { id: 'asc' },
          take: REFERENCE_SCAN_LIMIT + 1,
        });
        return resolveLocationRows(
          input,
          rows.slice(0, REFERENCE_SCAN_LIMIT),
          rows.length <= REFERENCE_SCAN_LIMIT,
        );
      }),
  });
  const result = await runAssistantLoop({
    execution,
    text,
    model: createAssistantToolModel(),
    facts,
    save: (data) => store.save(record, data),
    signal: request.signal,
    budget: cmd.budget,
  });
  await store.finish(record, result);
  return {
    conversationId: cmd.conversationId,
    revision: record.generation,
    executionId: record.id,
    execution: result,
  };
}
