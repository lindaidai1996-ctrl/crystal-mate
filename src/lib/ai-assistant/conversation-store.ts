import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { CandidateQueryError } from './candidate-contracts';
import type { QueryState } from './orchestration-contracts';
import type { Execution } from './orchestrator';
import type { AssistantFeedbackInput } from './feedback-contracts';
import { feedbackTargetSchema } from './feedback-contracts';
import { assistantQuestionTitle } from './conversation-title';

import { minimizeAssistantText, minimizeAssistantValue } from './privacy';
export { minimizeAssistantText } from './privacy';
export const ASSISTANT_LEASE_MS = 150_000;
function json(value: unknown): Prisma.InputJsonValue {
  return minimizeAssistantValue(value) as Prisma.InputJsonValue;
}
export type StoredExecution = {
  id: string;
  conversationId: string;
  ownerId: string;
  generation: number;
  parentId: string | null;
  text: string;
  data: Execution;
};
export class AssistantConversationStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async create(ownerId: string) {
    return this.client.assistantConversation.create({ data: { ownerId } });
  }
  async list(ownerId: string, cursor?: string) {
    return this.client.$transaction(
      async (tx) => {
        const after = cursor
          ? await tx.assistantConversation.findFirst({
              where: { id: cursor, ownerId },
              select: { id: true, createdAt: true },
            })
          : null;
        if (cursor && !after) throw new CandidateQueryError('CONVERSATION_NOT_FOUND');
        const where: Prisma.AssistantConversationWhereInput = {
          ownerId,
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {}),
        };
        const [total, items] = await Promise.all([
          tx.assistantConversation.count({ where }),
          tx.assistantConversation.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 31,
            select: {
              id: true,
              title: true,
              revision: true,
              updatedAt: true,
              messages: {
                where: { ownerId, role: 'user' },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: 1,
                select: { content: true },
              },
            },
          }),
        ]);
        return {
          items: items.slice(0, 30).map(({ messages, ...row }, index) => {
            const content = messages[0]?.content as { text?: unknown } | undefined;
            return {
              ...row,
              number: total - index,
              title:
                row.title ??
                (typeof content?.text === 'string' ? assistantQuestionTitle(content.text) : null),
              updatedAt: row.updatedAt.toISOString(),
            };
          }),
          nextCursor: items.length > 30 ? items[29].id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async rename(ownerId: string, conversationId: string, title: string) {
    const updated = await this.client.assistantConversation.updateMany({
      where: { id: conversationId, ownerId },
      // Naming does not change the execution generation or interrupt a running query.
      data: { title: Array.from(minimizeAssistantText(title)).slice(0, 80).join('') },
    });
    if (!updated.count) throw new CandidateQueryError('CONVERSATION_NOT_FOUND');
  }
  async remove(ownerId: string, conversationId: string) {
    // Child messages, executions and feedback cascade in the same database statement.
    // A running execution cannot save/finish after its parent has been deleted.
    const removed = await this.client.assistantConversation.deleteMany({
      where: { id: conversationId, ownerId },
    });
    if (!removed.count) throw new CandidateQueryError('CONVERSATION_NOT_FOUND');
  }
  async read(ownerId: string, conversationId: string) {
    return this.client.$transaction(
      async (tx) => {
        const session = await tx.assistantConversation.findFirst({
          where: { id: conversationId, ownerId },
        });
        if (!session) throw new CandidateQueryError('CONVERSATION_NOT_FOUND');
        const [latest, messages, feedback] = await Promise.all([
          tx.assistantExecution.findFirst({
            where: { conversationId, ownerId },
            orderBy: { generation: 'desc' },
          }),
          tx.assistantMessage.findMany({
            where: { conversationId, ownerId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
          }),
          tx.assistantFeedback.findMany({
            where: { conversationId, ownerId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
          }),
        ]);
        const interrupted = Boolean(
          session.activeExecutionId && session.leaseUntil && session.leaseUntil <= this.now(),
        );
        return {
          session: { ...session, state: session.state as QueryState | null },
          latest: latest ? { ...latest, data: latest.data as unknown as Execution } : null,
          messages,
          feedback,
          interrupted,
          recovery: interrupted
            ? {
                status: 'incomplete' as const,
                errorCode: 'EXECUTION_INTERRUPTED',
                nextAction: 'continue' as const,
              }
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async feedback(ownerId: string, input: AssistantFeedbackInput) {
    return this.client.$transaction(async (tx) => {
      const execution = await tx.assistantExecution.findFirst({
        where: { id: input.executionId, conversationId: input.conversationId, ownerId },
      });
      const question = await tx.assistantMessage.findFirst({
        where: {
          executionId: input.executionId,
          conversationId: input.conversationId,
          ownerId,
          role: 'user',
        },
        select: { id: true },
      });
      if (!execution || !question) throw new CandidateQueryError('CONVERSATION_NOT_FOUND');
      const data = execution.data as unknown as Execution;
      const target = input.target ?? null;
      const note = minimizeAssistantText(input.note);
      const existing = await tx.assistantFeedback.findFirst({
        where: { id: input.requestId, ownerId },
      });
      if (existing) {
        const identity = (value: AssistantFeedbackInput['target']) =>
          value
            ? [
                value.item.type,
                value.item.id,
                value.purchase?.type ?? null,
                value.purchase?.id ?? null,
              ].join(':')
            : '';
        const oldTarget = existing.target ? feedbackTargetSchema.parse(existing.target) : null;
        if (
          existing.executionId !== execution.id ||
          existing.kind !== input.kind ||
          existing.note !== note ||
          identity(oldTarget) !== identity(target)
        )
          throw new CandidateQueryError('FEEDBACK_ID_CONFLICT');
        return { id: existing.id, status: existing.status };
      }
      const saved = await tx.assistantFeedback.create({
        data: {
          id: input.requestId,
          ownerId,
          conversationId: input.conversationId,
          executionId: execution.id,
          questionMessageId: question.id,
          kind: input.kind,
          target: target ? json(target) : Prisma.DbNull,
          note,
          ruleVersion: data.metadata.ruleVersion,
          promptVersion: data.metadata.promptVersion,
          relevancePromptVersion: data.metadata.relevancePromptVersion,
        },
      });
      return { id: saved.id, status: saved.status };
    });
  }
  async begin(
    ownerId: string,
    conversationId: string,
    revision: number,
    text: string,
    data: Execution,
    parentId: string | null = null,
  ) {
    const id = randomUUID();
    const generation = revision + 1;
    const now = this.now();
    return this.client.$transaction(async (tx) => {
      const claim = await tx.assistantConversation.updateMany({
        where: {
          id: conversationId,
          ownerId,
          revision,
          OR: [{ activeExecutionId: null }, { leaseUntil: { lte: now } }],
        },
        data: {
          revision: generation,
          activeExecutionId: id,
          leaseUntil: new Date(now.getTime() + ASSISTANT_LEASE_MS),
        },
      });
      if (!claim.count) throw new CandidateQueryError('STALE_REVISION_OR_BUSY');
      if (parentId === null) {
        // Persist once, after claiming the execution and before storing its first message.
        // A manual title or any earlier question prevents automatic renaming.
        await tx.assistantConversation.updateMany({
          where: {
            id: conversationId,
            ownerId,
            title: null,
            messages: { none: { role: 'user' } },
          },
          data: { title: assistantQuestionTitle(text) },
        });
      }
      const record = await tx.assistantExecution.create({
        data: {
          id,
          conversationId,
          ownerId,
          generation,
          parentId,
          text: minimizeAssistantText(text),
          data: json(data),
        },
      });
      await tx.assistantMessage.create({
        data: {
          conversationId,
          ownerId,
          executionId: id,
          role: 'user',
          content: json({ text: minimizeAssistantText(text), resumedFrom: parentId }),
        },
      });
      return { ...record, data: record.data as unknown as Execution };
    });
  }
  async save(record: StoredExecution, execution: Execution) {
    const { ownerId, conversationId, generation, id } = record;
    await this.client.$transaction(async (tx) => {
      const current = await tx.assistantConversation.updateMany({
        where: {
          id: conversationId,
          ownerId,
          revision: generation,
          activeExecutionId: id,
          leaseUntil: { gt: this.now() },
        },
        data: {
          updatedAt: this.now(),
          ...(execution.state ? { state: json(execution.state) } : {}),
        },
      });
      if (!current.count) throw new CandidateQueryError('STALE_EXECUTION');
      const saved = await tx.assistantExecution.updateMany({
        where: { id, conversationId, ownerId, generation },
        data: { data: json(execution) },
      });
      if (!saved.count) throw new CandidateQueryError('EXECUTION_NOT_FOUND');
    });
  }
  async finish(record: StoredExecution, execution: Execution) {
    const { ownerId, conversationId, generation, id } = record;
    await this.client.$transaction(async (tx) => {
      const current = await tx.assistantConversation.updateMany({
        where: {
          id: conversationId,
          ownerId,
          revision: generation,
          activeExecutionId: id,
          leaseUntil: { gt: this.now() },
        },
        data: {
          activeExecutionId: null,
          leaseUntil: null,
          ...(execution.state ? { state: json(execution.state) } : {}),
        },
      });
      if (!current.count) throw new CandidateQueryError('STALE_EXECUTION');
      await tx.assistantExecution.updateMany({
        where: { id, conversationId, ownerId, generation },
        data: { data: json(execution) },
      });
      await tx.assistantMessage.create({
        data: {
          ownerId,
          conversationId,
          executionId: id,
          role: 'assistant',
          content: json({
            executionId: id,
            status: execution.status,
            clarification: execution.clarification,
            errorCode: execution.errorCode,
          }),
        },
      });
    });
  }
  async cancel(ownerId: string, conversationId: string, revision: number) {
    return this.client.$transaction(async (tx) => {
      const current = await tx.assistantConversation.findFirst({
        where: { id: conversationId, ownerId, revision },
      });
      if (!current) throw new CandidateQueryError('STALE_REVISION');
      const record = await tx.assistantExecution.findFirst({
        where: {
          conversationId,
          ownerId,
          ...(current.activeExecutionId ? { id: current.activeExecutionId } : {}),
        },
        orderBy: { generation: 'desc' },
      });
      if (
        !current.activeExecutionId &&
        record &&
        ['completed', 'no_results', 'cancelled'].includes(
          (record.data as unknown as Execution).status,
        )
      )
        return { revision, status: (record.data as unknown as Execution).status };
      const updated = await tx.assistantConversation.updateMany({
        where: { id: conversationId, ownerId, revision },
        data: { revision: { increment: 1 }, activeExecutionId: null, leaseUntil: null },
      });
      if (!updated.count) throw new CandidateQueryError('STALE_REVISION');
      if (record) {
        const data = record.data as unknown as Execution;
        data.status = 'cancelled';
        data.errorCode = 'CANCELLED';
        await tx.assistantExecution.updateMany({
          where: { id: record.id, ownerId, conversationId },
          data: { data: json(data) },
        });
        await tx.assistantMessage.upsert({
          where: { executionId_role: { executionId: record.id, role: 'assistant' } },
          create: {
            ownerId,
            conversationId,
            executionId: record.id,
            role: 'assistant',
            content: json({ status: 'cancelled' }),
          },
          update: { content: json({ status: 'cancelled' }) },
        });
      }
      return { revision: revision + 1, status: 'cancelled' as const };
    });
  }
}
