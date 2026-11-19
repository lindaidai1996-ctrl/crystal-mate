import { describe, expect, it } from 'vitest';
import type { AssistantBrowserConversation } from '@/lib/ai-assistant/browser-contracts';
import {
  conversationViewReducer as reduce,
  emptyConversationView,
} from '@/components/assistant/conversationView';

function conversation(
  revision: number,
  messages: { id: string; text: string | null }[] = [],
  privacy = false,
): AssistantBrowserConversation {
  return {
    id: 'conversation',
    revision,
    active: false,
    interrupted: false,
    privacy,
    state: null,
    feedback: [],
    latest: null,
    messages: messages.map((message) => ({
      ...message,
      role: 'user',
      status: null,
      executionId: null,
    })),
  };
}

const receive = (value: AssistantBrowserConversation) =>
  ({ type: 'snapshot', value, selectedId: 'conversation' }) as const;
const send = { type: 'send', id: 'local', text: '查库存', privacy: false } as const;

describe('assistant immediate message display', () => {
  it('shows the question before any request completes and keeps the existing history', () => {
    const snapshot = conversation(1, [{ id: 'old', text: '上一个问题' }]);
    const view = reduce(reduce(emptyConversationView, receive(snapshot)), send);
    expect(view.snapshot).toBe(snapshot);
    expect(view.pendingMessage).toMatchObject({ text: '查库存', delivery: 'sending' });
  });

  it('keeps a repeated question visible during stale polls, then replaces it once persisted', () => {
    const old = conversation(1, [{ id: 'old', text: '查库存' }]);
    const pending = reduce(reduce(emptyConversationView, receive(old)), send);
    expect(reduce(pending, receive(old)).pendingMessage).not.toBeNull();
    const saved = conversation(2, [...old.messages, { id: 'new', text: '查库存' }]);
    const confirmed = reduce(pending, receive(saved));
    expect(confirmed.pendingMessage).toBeNull();
    expect(confirmed.snapshot?.messages.map((message) => message.id)).toEqual(['old', 'new']);
    expect(reduce(confirmed, receive(old))).toBe(confirmed);
  });

  it('does not mistake a different question from another client for this submission', () => {
    const pending = reduce(reduce(emptyConversationView, receive(conversation(1))), send);
    const other = conversation(2, [{ id: 'other', text: '查采购' }]);
    expect(reduce(pending, receive(other)).pendingMessage?.text).toBe('查库存');
  });

  it('does not expose local question text in privacy mode and reconciles redacted messages', () => {
    for (const snapshotPrivacy of [false, true]) {
      const initial = reduce(emptyConversationView, receive(conversation(1, [], snapshotPrivacy)));
      const pending = reduce(initial, { ...send, text: '成本 123.45', privacy: true });
      expect(JSON.stringify(pending)).not.toContain('123.45');
      expect(pending.pendingMessage?.text).toBeNull();
      expect(
        reduce(pending, receive(conversation(2, [{ id: 'saved', text: null }], true)))
          .pendingMessage,
      ).toBeNull();
    }
  });

  it('preserves an unconfirmed question after a network error until a later read confirms it', () => {
    const pending = reduce(reduce(emptyConversationView, receive(conversation(1))), send);
    const failed = reduce(pending, { type: 'unconfirmed', id: 'local' });
    expect(failed.pendingMessage).toMatchObject({ text: '查库存', delivery: 'unconfirmed' });
    const saved = reduce(failed, receive(conversation(2, [{ id: 'saved', text: '查库存' }])));
    expect(saved.pendingMessage).toBeNull();
    expect(reduce(saved, { type: 'unconfirmed', id: 'local' })).toBe(saved);
  });

  it('drops local text on a conversation or privacy reset and ignores unrelated responses', () => {
    const pending = reduce(reduce(emptyConversationView, receive(conversation(1))), send);
    expect(reduce(pending, receive({ ...conversation(2), id: 'different-conversation' }))).toBe(
      pending,
    );
    expect(reduce(pending, { type: 'reset' })).toEqual(emptyConversationView);
  });
});
