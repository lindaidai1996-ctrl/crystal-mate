'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Input, InputNumber, Tabs, Typography } from 'antd';
import {
  CommentOutlined,
  LoadingOutlined,
  MenuOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { usePrivacyMode } from '@/components/privacyMode';
import { useAssistantConversation } from './useAssistantConversation';
import assistantStyles from './assistantPage.module.css';
import { AssistantResults } from './assistantResults';
import { AssistantUncertainPurchases } from './assistantUncertainPurchases';
import { AssistantScope } from './assistantScope';
import { AssistantFeedback } from './assistantFeedback';
import { AssistantSessions } from './assistantSessions';
import { AssistantAnswer } from './assistantAnswer';
import { formatAssistantDuration, formatAssistantTimeText } from './displayTime';
import { useAssistantNavigation } from './assistantNavigation';

export function AssistantPage({ initialId }: { initialId: string | null }) {
  const t = useTranslations('assistant');
  const common = useTranslations('common');
  const {
    menu: navigationMenu,
    open: navigationOpen,
    setOpen: setNavigationOpen,
    buttonRef: navigationButtonRef,
  } = useAssistantNavigation();
  const [navigationTab, setNavigationTab] = useState('sessions');
  const locale = useLocale();
  const privacy = usePrivacyMode();
  const assistant = useAssistantConversation(initialId, privacy);
  const [text, setText] = useState('');
  const [adjustBudget, setAdjustBudget] = useState(false);
  const [toolCalls, setToolCalls] = useState(12);
  const [toolTokens, setToolTokens] = useState(200000);
  const [relevanceCalls, setRelevanceCalls] = useState(20);
  const [relevanceTokens, setRelevanceTokens] = useState(200000);
  const budgets = adjustBudget
    ? {
        budget: { maxCalls: toolCalls, maxReservedTokens: toolTokens },
        relevanceBudget: { maxCalls: relevanceCalls, maxReservedTokens: relevanceTokens },
      }
    : undefined;
  const { snapshot, pending, pendingMessage, cancelling } = assistant;
  const chatScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const closeOnDesktop = () => {
      if (!media.matches) setNavigationOpen(false);
    };
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, [setNavigationOpen]);
  const followLatest = useRef(true);
  useEffect(() => {
    followLatest.current = true;
  }, [assistant.selectedId]);
  useEffect(() => {
    if (followLatest.current && chatScroll.current) {
      chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
    }
  }, [snapshot, pending, pendingMessage]);
  const latest = snapshot?.latest;
  const running = pending || snapshot?.active;
  const latestReply = latest
    ? snapshot?.messages.findLast(
        (message) => message.role === 'assistant' && message.executionId === latest.id,
      )
    : undefined;
  const showExecution =
    running ||
    (latest && (snapshot?.interrupted || (!latestReply && !latest.answer && !latest.results)));
  const activeStage = latest?.trace.findLast((event) => event.outcome === 'started')?.stage;
  const summarizing =
    activeStage === 'parse' &&
    latest?.trace.some((event) => event.stage === 'facts' && event.outcome === 'success');
  const progressText = cancelling
    ? t('cancelling')
    : !snapshot?.active
      ? t('working.parse')
      : t(`working.${summarizing ? 'finish' : (activeStage ?? 'parse')}`);
  const protectedText = privacy || snapshot?.privacy;
  const resumable =
    latest && !['running', 'completed', 'no_results', 'needs_confirmation'].includes(latest.status);
  const send = () => {
    if (!text.trim() || running) return;
    followLatest.current = true;
    void assistant.command('message', text.trim());
    setText('');
  };
  const sessions = (
    <AssistantSessions
      key={privacy ? 'private' : 'visible'}
      sessions={assistant.sessions}
      selectedId={assistant.selectedId}
      managingId={assistant.managingId}
      privacy={privacy}
      onSelect={(id) => {
        assistant.select(id);
        setNavigationOpen(false);
      }}
      onCreate={() => {
        void assistant.create();
        setNavigationOpen(false);
      }}
      onLoadMore={() => void assistant.loadMore()}
      onRename={assistant.rename}
      onRemove={assistant.remove}
    />
  );
  return (
    <div className={assistantStyles.page}>
      <header className={assistantStyles.heading}>
        <Button
          className={assistantStyles.mobileNavigationButton}
          icon={<MenuOutlined />}
          aria-label={t('navigation')}
          ref={navigationButtonRef}
          onClick={() => {
            setNavigationTab('sessions');
            setNavigationOpen(true);
          }}
        />
        <Typography.Title level={2}>{t('pageTitle')}</Typography.Title>
        <p>{t('subtitle')}</p>
        <Button
          className={assistantStyles.mobileNewConversation}
          icon={<PlusOutlined />}
          aria-label={t('newConversation')}
          title={t('newConversation')}
          onClick={() => void assistant.create()}
        />
      </header>
      <div className={assistantStyles.workspace}>
        <div className={assistantStyles.desktopSessions}>{sessions}</div>
        <section className={assistantStyles.conversation} aria-label={t('conversation')}>
          <div
            className={assistantStyles.chatScroll}
            ref={chatScroll}
            onScroll={(event) => {
              const area = event.currentTarget;
              followLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
            }}
          >
            {assistant.error && (
              <Alert
                type="error"
                showIcon
                message={t('requestFailed')}
                description={t(assistant.error === 'UNAUTHORIZED' ? 'loginRequired' : 'reloadHint')}
                action={
                  <Button icon={<ReloadOutlined />} onClick={assistant.reload}>
                    {t('refresh')}
                  </Button>
                }
              />
            )}
            {!assistant.selectedId ? (
              <div className={assistantStyles.welcome}>
                <CommentOutlined className={assistantStyles.welcomeIcon} />
                <Typography.Title level={3}>{t('welcome')}</Typography.Title>
                <p>{t('example')}</p>
                <Button type="primary" onClick={() => void assistant.create()}>
                  {t('newConversation')}
                </Button>
              </div>
            ) : !snapshot && assistant.error ? null : !snapshot ? (
              <div className={assistantStyles.conversationLoading} role="status" aria-busy="true">
                <div className={assistantStyles.loadingHeader}>
                  <span className={assistantStyles.loadingIcon}>
                    <LoadingOutlined spin />
                  </span>
                  <span>{t('loading')}</span>
                </div>
                <div className={assistantStyles.loadingPreview} aria-hidden="true">
                  <div className={assistantStyles.loadingQuestion} />
                  <div className={assistantStyles.loadingAnswer}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className={assistantStyles.loadingComposer} />
                </div>
              </div>
            ) : (
              <>
                <div className={assistantStyles.messages} role="log" aria-label={t('history')}>
                  {snapshot.messages.length === 0 && !pendingMessage && (
                    <p className={assistantStyles.muted}>{t('startHint')}</p>
                  )}
                  {snapshot.messages.map((message) => (
                    <article
                      key={message.id}
                      className={
                        message.role === 'user'
                          ? assistantStyles.userMessage
                          : assistantStyles.assistantMessage
                      }
                    >
                      {message.role !== 'user' && <strong>{t('title')}</strong>}
                      {message.answer ? (
                        <AssistantAnswer answer={message.answer} privacy={Boolean(protectedText)} />
                      ) : (
                        <p>
                          {protectedText && message.role === 'user'
                            ? t('privateText')
                            : message.role === 'user'
                              ? (message.text ?? t('privateText'))
                              : formatAssistantTimeText(
                                  message.text ??
                                    (message.status
                                      ? t(`status.${message.status}`)
                                      : t('privateText')),
                                  locale,
                                )}
                        </p>
                      )}
                      {message.executionId === latest?.id &&
                        message.answer &&
                        !message.answer.blocks.every(
                          (block) => block.type === 'data' && block.format === 'names',
                        ) &&
                        latest.results?.uncertainPurchases && (
                          <AssistantUncertainPurchases
                            pending={latest.results.uncertainPurchases}
                            privacy={Boolean(protectedText)}
                          />
                        )}
                    </article>
                  ))}
                  {pendingMessage && (
                    <article key={pendingMessage.id} className={assistantStyles.userMessage}>
                      <p>{protectedText ? t('privateText') : pendingMessage.text}</p>
                      {pendingMessage.delivery === 'unconfirmed' && (
                        <small className={assistantStyles.deliveryStatus}>
                          {t('messageUnconfirmed')}
                        </small>
                      )}
                    </article>
                  )}
                </div>
                {showExecution && (
                  <section
                    className={assistantStyles.execution}
                    aria-live="polite"
                    aria-label={t('progress')}
                    aria-busy={Boolean(running)}
                  >
                    <div className={assistantStyles.progressLine}>
                      {running ? <LoadingOutlined spin /> : null}
                      <span>{running ? progressText : t(`status.${latest!.status}`)}</span>
                    </div>
                    {!running && !protectedText && latest?.clarification && (
                      <p>{formatAssistantTimeText(latest.clarification, locale)}</p>
                    )}
                    {snapshot.interrupted && <Alert type="warning" message={t('interrupted')} />}
                  </section>
                )}
                {!running && latest?.results && !latest.answer && (
                  <AssistantResults
                    key={`results-${latest.id}`}
                    result={latest.results}
                    privacy={Boolean(protectedText)}
                    grouped={snapshot.state?.view === 'by_distributor'}
                  />
                )}
                <div className={assistantStyles.conversationMeta}>
                  <details key={latest?.id} className={assistantStyles.queryDetails}>
                    <summary>{t('queryDetails')}</summary>
                    {!running && latest && (
                      <p>
                        {t(`status.${latest.status}`)}
                        {!protectedText && latest.clarification
                          ? ` · ${formatAssistantTimeText(latest.clarification, locale)}`
                          : ''}
                      </p>
                    )}
                    <p className={assistantStyles.muted}>{t('historyLimit')}</p>
                    {latest && (
                      <details className={assistantStyles.answerSources}>
                        <summary>{t('executionDetails')}</summary>
                        <p>{t('progressHint')}</p>
                        <ol className={assistantStyles.trace}>
                          {latest.trace.slice(-8).map((event, index) => (
                            <li key={index}>
                              {t(`stage.${event.stage}`)} · {t(`outcome.${event.outcome}`)}
                              {event.durationMs > 0
                                ? ` · ${formatAssistantDuration(event.durationMs, locale)}`
                                : ''}
                            </li>
                          ))}
                        </ol>
                        {latest.errorCode && (
                          <p>
                            {t('errorCode')}: {latest.errorCode}
                          </p>
                        )}
                      </details>
                    )}
                    <AssistantScope
                      key={`scope-${latest?.id}`}
                      snapshot={snapshot}
                      privacy={Boolean(protectedText)}
                    />
                    {!running && resumable && (
                      <details className={assistantStyles.budget}>
                        <summary>{t('budgetSettings')}</summary>
                        <p>{t('budgetHelp')}</p>
                        <Checkbox
                          checked={adjustBudget}
                          onChange={(event) => setAdjustBudget(event.target.checked)}
                        >
                          {t('adjustBudget')}
                        </Checkbox>
                        {adjustBudget && (
                          <div className={assistantStyles.budgetFields}>
                            <label>
                              {t('toolCallsLimit')}
                              <InputNumber
                                aria-label={t('toolCallsLimit')}
                                value={toolCalls}
                                min={1}
                                max={20}
                                precision={0}
                                onChange={(n) => setToolCalls(n ?? 6)}
                              />
                            </label>
                            <label>
                              {t('toolTokensLimit')}
                              <InputNumber
                                aria-label={t('toolTokensLimit')}
                                value={toolTokens}
                                min={1}
                                max={500000}
                                precision={0}
                                onChange={(n) => setToolTokens(n ?? 100000)}
                              />
                            </label>
                            <label>
                              {t('relevanceCallsLimit')}
                              <InputNumber
                                aria-label={t('relevanceCallsLimit')}
                                value={relevanceCalls}
                                min={1}
                                max={200}
                                precision={0}
                                onChange={(n) => setRelevanceCalls(n ?? 20)}
                              />
                            </label>
                            <label>
                              {t('relevanceTokensLimit')}
                              <InputNumber
                                aria-label={t('relevanceTokensLimit')}
                                value={relevanceTokens}
                                min={1}
                                max={2000000}
                                precision={0}
                                onChange={(n) => setRelevanceTokens(n ?? 200000)}
                              />
                            </label>
                          </div>
                        )}
                      </details>
                    )}
                  </details>
                  {!running && resumable && (
                    <div className={assistantStyles.controls}>
                      <Button
                        onClick={() => void assistant.command('continue', undefined, budgets)}
                      >
                        {t('continue')}
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => void assistant.command('retry', undefined, budgets)}
                      >
                        {t('retry')}
                      </Button>
                    </div>
                  )}
                  {latest && !running && (
                    <AssistantFeedback
                      key={`feedback-${latest.id}`}
                      snapshot={snapshot}
                      privacy={Boolean(protectedText)}
                      onSaved={assistant.reload}
                    />
                  )}
                </div>
              </>
            )}
          </div>
          {snapshot && (
            <form
              className={assistantStyles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <Input.TextArea
                aria-label={t('question')}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                  ) {
                    return;
                  }
                  event.preventDefault();
                  if (event.repeat) return;
                  if (event.metaKey || event.ctrlKey) {
                    const input = event.currentTarget;
                    const remainingLength =
                      input.value.length - (input.selectionEnd - input.selectionStart);
                    if (remainingLength >= input.maxLength) return;
                    input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
                    setText(input.value);
                    return;
                  }
                  send();
                }}
                placeholder={t('placeholder')}
                autoSize={{ minRows: 1, maxRows: 4 }}
                maxLength={4000}
                disabled={Boolean(running)}
              />
              <div className={assistantStyles.composerFooter}>
                <span>{t('keyboardHint')}</span>
                {running ? (
                  <Button
                    type="primary"
                    htmlType="button"
                    className={assistantStyles.composerAction}
                    icon={<span className={assistantStyles.stopIcon} aria-hidden="true" />}
                    aria-label={t('cancel')}
                    title={t('cancel')}
                    disabled={cancelling}
                    onClick={() => void assistant.command('cancel')}
                  />
                ) : (
                  <Button
                    type="primary"
                    htmlType="submit"
                    className={assistantStyles.composerAction}
                    icon={<SendOutlined />}
                    aria-label={t('send')}
                    title={t('send')}
                    disabled={!text.trim()}
                  />
                )}
              </div>
            </form>
          )}
        </section>
      </div>
      <Drawer
        title={t('navigation')}
        placement="left"
        width="min(340px, calc(100vw - 32px))"
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
        afterOpenChange={(visible) => {
          if (!visible) navigationButtonRef.current?.focus();
        }}
        className={assistantStyles.navigationDrawer}
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        <Tabs
          className={assistantStyles.navigationTabs}
          activeKey={navigationTab}
          onChange={setNavigationTab}
          items={[
            {
              key: 'sessions',
              label: t('sessions'),
              children: <div className={assistantStyles.navigationSessions}>{sessions}</div>,
            },
            {
              key: 'menu',
              label: common('menu'),
              children: <div className={assistantStyles.navigationMenu}>{navigationMenu}</div>,
            },
          ]}
        />
      </Drawer>
    </div>
  );
}
