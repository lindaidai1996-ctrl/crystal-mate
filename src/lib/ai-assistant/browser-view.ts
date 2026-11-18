import type { AssistantConversationStore } from './conversation-store';
import type { AssistantBrowserConversation } from './browser-contracts';
import type { Execution } from './orchestrator';
import { assistantResultView } from './result-view';
import { assistantProgressView } from './progress-view';
import { assistantFeedbackKindSchema, feedbackTargetSchema } from './feedback-contracts';
import { answerDocumentView } from './answer-document';

export function assistantBrowserView(
  source: Awaited<ReturnType<AssistantConversationStore['read']>>,
  privacy: boolean,
): AssistantBrowserConversation {
  const latest = source.latest;
  return {
    id: source.session.id,
    revision: source.session.revision,
    active: Boolean(source.session.activeExecutionId) && !source.interrupted,
    interrupted: source.interrupted,
    privacy,
    // Conditions and messages can contain user-supplied costs; hide arbitrary prose in privacy mode.
    state: privacy ? null : source.session.state,
    feedback: (source.feedback ?? []).map((row) => ({
      id: row.id,
      executionId: row.executionId,
      questionMessageId: row.questionMessageId,
      kind: assistantFeedbackKindSchema.parse(row.kind),
      target: row.target ? feedbackTargetSchema.parse(row.target) : null,
      note: privacy ? null : row.note,
      ruleVersion: row.ruleVersion,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    messages: [...source.messages].reverse().map((message) => {
      const content = message.content as {
        text?: string;
        status?: Execution['status'];
        answer?: unknown;
        clarification?: string;
      };
      return {
        id: message.id,
        role: message.role,
        text: privacy ? null : (content.text ?? content.clarification ?? null),
        answer: answerDocumentView(content.answer, privacy),
        status: content.status ?? null,
        executionId: message.executionId,
      };
    }),
    latest: latest
      ? {
          id: latest.id,
          generation: latest.generation,
          status: source.interrupted ? 'incomplete' : latest.data.status,
          phase: latest.data.phase,
          clarification: privacy ? null : latest.data.clarification,
          errorCode: source.interrupted ? 'EXECUTION_INTERRUPTED' : latest.data.errorCode,
          metadata: latest.data.metadata,
          progress: assistantProgressView(latest.data, privacy),
          pendingPlan: privacy ? null : latest.data.pendingPlan,
          answer:
            !source.interrupted &&
            ['completed', 'no_results', 'needs_confirmation'].includes(latest.data.status)
              ? answerDocumentView(latest.data.answer, privacy)
              : null,
          results:
            ['completed', 'no_results', 'needs_confirmation'].includes(latest.data.status) &&
            !source.interrupted
              ? assistantResultView(latest.data.result, privacy)
              : null,
          trace: latest.data.trace.map(({ stage, outcome, durationMs, code }) => ({
            stage,
            outcome,
            durationMs,
            code,
          })),
        }
      : null,
  };
}
