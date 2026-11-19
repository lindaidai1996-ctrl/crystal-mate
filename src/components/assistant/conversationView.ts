import {
  acceptAssistantSnapshot,
  type AssistantBrowserConversation,
} from '@/lib/ai-assistant/browser-contracts';

type PendingMessage = {
  id: string;
  text: string | null;
  knownUserIds: string[];
  delivery: 'sending' | 'unconfirmed';
};

export type ConversationView = {
  snapshot: AssistantBrowserConversation | null;
  pendingMessage: PendingMessage | null;
};

type ViewAction =
  | { type: 'reset' }
  | { type: 'send'; id: string; text: string; privacy: boolean }
  | { type: 'unconfirmed'; id: string }
  | { type: 'snapshot'; value: AssistantBrowserConversation; selectedId: string };

export const emptyConversationView: ConversationView = { snapshot: null, pendingMessage: null };

export function conversationViewReducer(
  state: ConversationView,
  action: ViewAction,
): ConversationView {
  switch (action.type) {
    case 'reset':
      return emptyConversationView;
    case 'send':
      if (!state.snapshot) return state;
      return {
        ...state,
        pendingMessage: {
          id: action.id,
          text: action.privacy || state.snapshot.privacy ? null : action.text,
          knownUserIds: state.snapshot.messages
            .filter((message) => message.role === 'user')
            .map((message) => message.id),
          delivery: 'sending',
        },
      };
    case 'unconfirmed':
      return state.pendingMessage?.id === action.id
        ? { ...state, pendingMessage: { ...state.pendingMessage, delivery: 'unconfirmed' } }
        : state;
    case 'snapshot': {
      if (!acceptAssistantSnapshot(state.snapshot, action.value, action.selectedId)) return state;
      const pending = state.pendingMessage;
      // Match a new persisted user message, including repeated questions and privacy projections.
      const confirmed =
        pending &&
        action.value.messages.some(
          (message) =>
            message.role === 'user' &&
            !pending.knownUserIds.includes(message.id) &&
            (pending.text === null || action.value.privacy || message.text === pending.text),
        );
      return {
        snapshot: action.value,
        pendingMessage: confirmed ? null : pending,
      };
    }
  }
}
