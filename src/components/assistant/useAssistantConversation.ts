'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  type AssistantBrowserConversation,
  type AssistantSessionList,
} from '@/lib/ai-assistant/browser-contracts';
import { conversationViewReducer, emptyConversationView } from './conversationView';

const endpoint = '/api/assistant/conversations';
export async function assistantFetch<T>(
  url: string,
  privacy: boolean,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-assistant-privacy': privacy ? 'on' : 'off',
      ...init?.headers,
    },
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'ASSISTANT_REQUEST_FAILED');
  return value as T;
}

export function useAssistantConversation(initialId: string | null, privacy: boolean) {
  const [selectedId, setSelectedId] = useState(initialId);
  const [sessions, setSessions] = useState<AssistantSessionList>({ items: [], nextCursor: null });
  const [{ snapshot, pendingMessage }, dispatchView] = useReducer(
    conversationViewReducer,
    emptyConversationView,
  );
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const applied = useRef(0);
  const currentId = useRef(selectedId);
  const commandRequest = useRef<AbortController | null>(null);
  const listSequence = useRef(0);
  const listPrivacy = useRef(privacy);
  const executionPrivacy = useRef(privacy);
  const managing = useRef(false);
  useEffect(() => {
    listPrivacy.current = privacy;
  }, [privacy]);

  const select = useCallback((id: string | null) => {
    epoch.current++;
    commandRequest.current?.abort();
    currentId.current = id;
    setSelectedId(id);
    dispatchView({ type: 'reset' });
    setPending(false);
    setError(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('conversation', id);
    else url.searchParams.delete('conversation');
    window.history.replaceState(null, '', url);
  }, []);

  const list = useCallback(
    async (more = false) => {
      const order = ++listSequence.current;
      const requestedPrivacy = privacy;
      const cursor = more ? sessions.nextCursor : null;
      const value = await assistantFetch<AssistantSessionList>(
        `${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        requestedPrivacy,
      );
      if (order !== listSequence.current || requestedPrivacy !== listPrivacy.current) return;
      setSessions((old) => ({
        ...value,
        items: more
          ? [...old.items, ...value.items.filter((row) => !old.items.some((x) => x.id === row.id))]
          : value.items,
      }));
    },
    [sessions.nextCursor, privacy],
  );

  useEffect(() => {
    let active = true;
    const order = ++listSequence.current;
    void assistantFetch<AssistantSessionList>(endpoint, privacy)
      .then((value) => {
        if (active && order === listSequence.current) setSessions(value);
      })
      .catch((cause: Error) => {
        if (active && order === listSequence.current) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [privacy]);

  const apply = useCallback(
    (value: AssistantBrowserConversation, version: number, order: number) => {
      if (epoch.current !== version || order < applied.current || currentId.current !== value.id)
        return;
      applied.current = order;
      dispatchView({ type: 'snapshot', value, selectedId: currentId.current! });
    },
    [],
  );

  useEffect(() => {
    if (executionPrivacy.current === privacy) return;
    executionPrivacy.current = privacy;
    const id = currentId.current;
    const inFlight = commandRequest.current && !commandRequest.current.signal.aborted;
    const privacyEpoch = ++epoch.current;
    commandRequest.current?.abort();
    setPending(false);
    dispatchView({ type: 'reset' });
    setRefresh((n) => n + 1);
    if (!id || (!inFlight && !snapshot?.active)) return;
    // A server-side CAS cancellation prevents another model request with the old privacy input.
    void assistantFetch<AssistantBrowserConversation>(`${endpoint}/${id}`, true)
      .then(async (value) => {
        if (currentId.current === id && epoch.current === privacyEpoch) {
          await assistantFetch(`${endpoint}/${id}`, true, {
            method: 'POST',
            body: JSON.stringify({
              action: 'cancel',
              revision: value.revision,
              reason: 'privacy_changed',
            }),
          });
          setRefresh((n) => n + 1);
        }
      })
      .catch(() => {});
  }, [privacy, snapshot?.active]);

  useEffect(() => {
    if (
      snapshot &&
      sessions.items.some((row) => row.id === snapshot.id && row.revision < snapshot.revision)
    ) {
      // The first persisted question names the conversation while its query is still running.
      void list().catch(() => {});
    }
  }, [snapshot, sessions.items, list]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const version = epoch.current;
    const read = async () => {
      const order = ++sequence.current;
      try {
        const value = await assistantFetch<AssistantBrowserConversation>(
          `${endpoint}/${selectedId}`,
          privacy,
          { signal: controller.signal },
        );
        if (!active) return;
        apply(value, version, order);
        // Poll persisted stages. No invented token stream or progress percentage.
        if (value.active || pending) timer = setTimeout(read, 1200);
      } catch (cause) {
        if (active && epoch.current === version) setError((cause as Error).message);
      }
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedId, privacy, pending, refresh, apply]);

  useEffect(() => () => commandRequest.current?.abort(), []);

  const create = async () => {
    try {
      const created = await assistantFetch<{ id: string }>(endpoint, true, {
        method: 'POST',
        body: '{}',
      });
      select(created.id);
      await list();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const manage = async (id: string, title?: string) => {
    if (managing.current) return false;
    managing.current = true;
    setManagingId(id);
    setError(null);
    try {
      await assistantFetch(`${endpoint}/${id}`, privacy, {
        method: title === undefined ? 'DELETE' : 'PATCH',
        ...(title === undefined ? {} : { body: JSON.stringify({ title }) }),
      });
      // Invalidate older list reads so they cannot restore a deleted row or old name.
      listSequence.current++;
      if (title === undefined) {
        setSessions((old) => ({
          ...old,
          items: old.items.filter((row) => row.id !== id),
          nextCursor: old.nextCursor === id ? null : old.nextCursor,
        }));
        if (currentId.current === id) select(null);
      } else {
        setSessions((old) => ({
          ...old,
          items: old.items.map((row) =>
            row.id === id ? { ...row, title: privacy ? null : title } : row,
          ),
        }));
      }
      void list().catch((cause: Error) => setError(cause.message));
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      managing.current = false;
      setManagingId(null);
    }
  };

  const command = async (
    action: 'message' | 'continue' | 'retry' | 'cancel',
    text?: string,
    budgets?: {
      budget: { maxCalls: number; maxReservedTokens: number };
      relevanceBudget: { maxCalls: number; maxReservedTokens: number };
    },
  ) => {
    if (!selectedId || !snapshot || ((pending || commandRequest.current) && action !== 'cancel'))
      return;
    const id = selectedId;
    const version = ++epoch.current;
    if (action === 'cancel' && pendingMessage) {
      dispatchView({ type: 'unconfirmed', id: pendingMessage.id });
    }
    commandRequest.current?.abort();
    const controller = new AbortController();
    commandRequest.current = controller;
    const localMessageId = action === 'message' ? `local-${version}` : null;
    if (localMessageId) {
      dispatchView({ type: 'send', id: localMessageId, text: text ?? '', privacy });
    }
    setPending(true);
    setPendingAction(action);
    setError(null);
    setRefresh((n) => n + 1);
    try {
      // Cancel uses the current persisted generation, including a claim made since the last poll.
      const revision =
        action === 'cancel'
          ? (await assistantFetch<AssistantBrowserConversation>(`${endpoint}/${id}`, privacy))
              .revision
          : snapshot.revision;
      await assistantFetch<AssistantBrowserConversation>(`${endpoint}/${id}`, privacy, {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          action,
          revision,
          ...(action === 'message' ? { text } : {}),
          ...(action === 'continue' || action === 'retry' ? budgets : {}),
        }),
      });
      // The POST response may have been projected before the privacy preference changed.
      // Read again with the live preference and never install the old response directly.
    } catch (cause) {
      if (epoch.current === version && !controller.signal.aborted) {
        setError((cause as Error).message);
        if (localMessageId) dispatchView({ type: 'unconfirmed', id: localMessageId });
      }
    } finally {
      if (commandRequest.current === controller) commandRequest.current = null;
      if (epoch.current === version && currentId.current === id) {
        setPending(false);
        setRefresh((n) => n + 1);
        void list().catch(() => {});
      }
    }
  };

  return {
    selectedId,
    sessions,
    snapshot,
    pendingMessage,
    pending,
    cancelling: pending && pendingAction === 'cancel',
    managingId,
    error,
    select,
    create,
    command,
    rename: (id: string, title: string) => manage(id, title),
    remove: (id: string) => manage(id),
    reload: () => setRefresh((n) => n + 1),
    loadMore: () => list(true).catch((cause: Error) => setError(cause.message)),
  };
}
