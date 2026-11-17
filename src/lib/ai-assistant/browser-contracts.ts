import type { Execution, TraceEvent } from './orchestrator';
import type { QueryState } from './orchestration-contracts';
import type { AssistantBrowserResults } from './result-view';
import type { AssistantProgress } from './progress-view';
import type { AssistantFeedbackInput } from './feedback-contracts';

// A deliberate browser projection. Checkpoints, owner IDs and model input never cross HTTP.
export type AssistantSessionList = {
  items: {
    id: string;
    number: number;
    title: string | null;
    revision: number;
    updatedAt: string;
  }[];
  nextCursor: string | null;
};
export type AssistantBrowserConversation = {
  id: string;
  revision: number;
  active: boolean;
  interrupted: boolean;
  privacy: boolean;
  state: QueryState | null;
  feedback: {
    id: string;
    executionId: string;
    questionMessageId: string;
    kind: AssistantFeedbackInput['kind'];
    target: AssistantFeedbackInput['target'];
    note: string | null;
    ruleVersion: string;
    status: string;
    createdAt: string;
  }[];
  messages: {
    id: string;
    role: string;
    text: string | null;
    status: Execution['status'] | null;
    executionId: string | null;
  }[];
  latest: {
    id: string;
    generation: number;
    status: Execution['status'];
    phase: Execution['phase'];
    clarification: string | null;
    errorCode: string | null;
    metadata: Execution['metadata'];
    results: AssistantBrowserResults | null;
    progress: AssistantProgress;
    // Pending edits are distinct from confirmed state; privacy removes their free text.
    pendingPlan: Execution['pendingPlan'];
    trace: Pick<TraceEvent, 'stage' | 'outcome' | 'durationMs' | 'code'>[];
  } | null;
};

// In-flight reads may arrive out of order even within one conversation.
export function acceptAssistantSnapshot(
  current: Pick<AssistantBrowserConversation, 'id' | 'revision'> | null,
  incoming: Pick<AssistantBrowserConversation, 'id' | 'revision'>,
  selectedId: string,
) {
  return (
    incoming.id === selectedId &&
    (!current || current.id !== incoming.id || incoming.revision >= current.revision)
  );
}
