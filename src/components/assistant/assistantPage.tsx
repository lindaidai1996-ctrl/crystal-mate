'use client';

import { useState } from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Tag, Typography } from 'antd';
import {
  CommentOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { usePrivacyMode } from '@/components/privacyMode';
import { useAssistantConversation } from './useAssistantConversation';
import assistantStyles from './assistantPage.module.css';
import { AssistantResults } from './assistantResults';
import { AssistantScope } from './assistantScope';
import { AssistantFeedback } from './assistantFeedback';
import { AssistantSessions } from './assistantSessions';

export function AssistantPage({ initialId }: { initialId: string | null }) {
  const t = useTranslations('assistant');
  const privacy = usePrivacyMode();
  const assistant = useAssistantConversation(initialId, privacy);
  const [text, setText] = useState('');
  const [adjustBudget, setAdjustBudget] = useState(false);
  const [toolCalls, setToolCalls] = useState(6);
  const [toolTokens, setToolTokens] = useState(100000);
  const [relevanceCalls, setRelevanceCalls] = useState(20);
  const [relevanceTokens, setRelevanceTokens] = useState(200000);
  const budgets = adjustBudget
    ? {
        budget: { maxCalls: toolCalls, maxReservedTokens: toolTokens },
        relevanceBudget: { maxCalls: relevanceCalls, maxReservedTokens: relevanceTokens },
      }
    : undefined;
  const { snapshot, pending } = assistant;
  const latest = snapshot?.latest;
  const running = pending || snapshot?.active;
  const protectedText = privacy || snapshot?.privacy;
  const resumable =
    latest && !['running', 'completed', 'no_results', 'needs_confirmation'].includes(latest.status);
  const send = () => {
    if (!text.trim() || running) return;
    void assistant.command('message', text.trim());
    setText('');
  };
  return (
    <div className={assistantStyles.page}>
      <header className={assistantStyles.heading}>
        <div>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <p>{t('subtitle')}</p>
        </div>
        <Tag icon={<CommentOutlined />}>{t('readOnly')}</Tag>
      </header>
      <div className={assistantStyles.workspace}>
        <AssistantSessions
          key={privacy ? 'private' : 'visible'}
          sessions={assistant.sessions}
          selectedId={assistant.selectedId}
          managingId={assistant.managingId}
          privacy={privacy}
          onSelect={assistant.select}
          onCreate={() => void assistant.create()}
          onLoadMore={() => void assistant.loadMore()}
          onRename={assistant.rename}
          onRemove={assistant.remove}
        />
        <section className={assistantStyles.conversation} aria-label={t('conversation')}>
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
                <p className={assistantStyles.muted}>{t('historyLimit')}</p>
                {snapshot.messages.length === 0 && (
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
                    <strong>{message.role === 'user' ? t('you') : t('title')}</strong>
                    <p>
                      {protectedText && message.role === 'user'
                        ? t('privateText')
                        : (message.text ??
                          (message.status ? t(`status.${message.status}`) : t('privateText')))}
                    </p>
                  </article>
                ))}
              </div>
              {latest && (
                <section
                  className={assistantStyles.execution}
                  aria-live="polite"
                  aria-label={t('progress')}
                >
                  <Tag
                    color={
                      latest.status === 'completed'
                        ? 'success'
                        : latest.status === 'running'
                          ? 'processing'
                          : 'default'
                    }
                  >
                    {t(`status.${latest.status}`)}
                  </Tag>
                  <p className={assistantStyles.muted}>{t('progressHint')}</p>
                  <ol className={assistantStyles.trace}>
                    {latest.trace.slice(-8).map((event, index) => (
                      <li key={index}>
                        {t(`stage.${event.stage}`)} · {t(`outcome.${event.outcome}`)}
                        {event.durationMs > 0 ? ` · ${event.durationMs} ms` : ''}
                      </li>
                    ))}
                  </ol>
                  {!protectedText && latest.clarification && <p>{latest.clarification}</p>}
                  {snapshot.interrupted && <Alert type="warning" message={t('interrupted')} />}
                  {latest.errorCode && (
                    <p className={assistantStyles.muted}>
                      {t('errorCode')}: {latest.errorCode}
                    </p>
                  )}
                </section>
              )}
              <AssistantScope
                key={`scope-${latest?.id}`}
                snapshot={snapshot}
                privacy={Boolean(protectedText)}
              />
              {latest?.results && (
                <AssistantResults
                  key={`results-${latest.id}`}
                  result={latest.results}
                  privacy={Boolean(protectedText)}
                  grouped={snapshot.state?.view === 'by_distributor'}
                />
              )}
              <div className={assistantStyles.controls}>
                {running && (
                  <Button icon={<StopOutlined />} onClick={() => void assistant.command('cancel')}>
                    {t('cancel')}
                  </Button>
                )}
                {!running && resumable && (
                  <>
                    <Button onClick={() => void assistant.command('continue', undefined, budgets)}>
                      {t('continue')}
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={() => void assistant.command('retry', undefined, budgets)}
                    >
                      {t('retry')}
                    </Button>
                  </>
                )}
              </div>
              {latest && !running && (
                <AssistantFeedback
                  key={`feedback-${latest.id}`}
                  snapshot={snapshot}
                  privacy={Boolean(protectedText)}
                  onSaved={assistant.reload}
                />
              )}
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
                  placeholder={t('placeholder')}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  maxLength={4000}
                  disabled={Boolean(running)}
                />
                <div className={assistantStyles.composerFooter}>
                  <span>{t('nonStreaming')}</span>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    disabled={!text.trim() || Boolean(running)}
                  >
                    {t('send')}
                  </Button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
