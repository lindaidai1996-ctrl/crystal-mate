'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AssistantBrowserConversation } from '@/lib/ai-assistant/browser-contracts';
import type { AssistantFeedbackInput } from '@/lib/ai-assistant/feedback-contracts';
import { assistantRecordHref } from '@/lib/ai-assistant/result-view';
import { assistantFetch } from './useAssistantConversation';
import assistantStyles from './assistantPage.module.css';

export function AssistantFeedback({
  snapshot,
  privacy,
  onSaved,
}: {
  snapshot: AssistantBrowserConversation;
  privacy: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('assistant');
  const [kind, setKind] = useState<AssistantFeedbackInput['kind']>('misunderstood');
  const [selected, setSelected] = useState<string>();
  const [manual, setManual] = useState(false);
  const [itemType, setItemType] = useState<'MATERIAL' | 'PRODUCT'>('MATERIAL');
  const [itemId, setItemId] = useState('');
  const [purchaseId, setPurchaseId] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<'success' | 'error' | null>(null);
  const requestId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const latest = snapshot.latest;
  if (!latest) return null;
  const targetKey = (target: NonNullable<AssistantFeedbackInput['target']>) =>
    `${target.item.type}:${target.item.id}:${target.purchase?.id ?? ''}`;
  const targets = new Map<
    string,
    { target: NonNullable<AssistantFeedbackInput['target']>; name: string }
  >();
  for (const decision of latest.progress.decisions) {
    const target = { item: decision.item, purchase: decision.purchase };
    targets.set(targetKey(target), {
      target,
      name: `${privacy ? t('privateText') : (decision.name ?? decision.item.id)} · ${t(`decision.${decision.status}`)} · ${(decision.purchase?.id ?? decision.item.id).slice(-6)}`,
    });
  }
  for (const row of latest.results?.purchases ?? []) {
    const target = { item: row.item, purchase: row.purchase };
    targets.set(targetKey(target), {
      target,
      name: `${privacy ? t('privateText') : row.name} · ${row.purchase.id.slice(-6)}`,
    });
  }
  for (const row of latest.results?.catalog ?? []) {
    const target = { item: row.item, purchase: row.purchase };
    if (!targets.has(targetKey(target)))
      targets.set(targetKey(target), { target, name: privacy ? t('privateText') : row.name });
  }
  const changed = () => {
    requestId.current = null;
    setMessage(null);
  };
  const target =
    kind === 'misunderstood'
      ? null
      : manual
        ? {
            item: { type: itemType, id: itemId.trim() },
            purchase: purchaseId.trim()
              ? {
                  type:
                    itemType === 'MATERIAL'
                      ? ('MATERIAL_PURCHASE' as const)
                      : ('PRODUCT_PURCHASE' as const),
                  id: purchaseId.trim(),
                }
              : null,
          }
        : selected
          ? (targets.get(selected)?.target ?? null)
          : null;
  const submit = async () => {
    if (
      sending ||
      (kind !== 'misunderstood' && !target) ||
      (kind === 'misunderstood' && !note.trim())
    )
      return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    requestId.current ??= crypto.randomUUID();
    setSending(true);
    setMessage(null);
    try {
      await assistantFetch('/api/assistant/feedback', privacy, {
        method: 'POST',
        signal,
        body: JSON.stringify({
          requestId: requestId.current,
          conversationId: snapshot.id,
          executionId: latest.id,
          kind,
          target,
          note,
        }),
      });
      if (!signal.aborted) {
        setMessage('success');
        setNote('');
        requestId.current = null;
        onSaved();
      }
    } catch {
      if (!signal.aborted) setMessage('error');
    } finally {
      if (!signal.aborted) setSending(false);
    }
  };
  return (
    <section className={assistantStyles.feedback} aria-label={t('feedbackTitle')}>
      <details>
        <summary>{t('feedbackTitle')}</summary>
        <p className={assistantStyles.muted}>{t('feedbackHelp')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            {t('feedbackKind')}
            <Select
              aria-label={t('feedbackKind')}
              value={kind}
              onChange={(value) => {
                setKind(value);
                changed();
              }}
              options={['should_include', 'does_not_belong', 'misunderstood'].map((value) => ({
                value,
                label: t(`feedbackKinds.${value}`),
              }))}
            />
          </label>
          {kind !== 'misunderstood' && (
            <>
              <Checkbox
                checked={manual}
                onChange={(event) => {
                  setManual(event.target.checked);
                  changed();
                }}
              >
                {t('manualRecord')}
              </Checkbox>
              {manual ? (
                <>
                  <Select
                    aria-label={t('recordType')}
                    value={itemType}
                    onChange={(value) => {
                      setItemType(value);
                      changed();
                    }}
                    options={['MATERIAL', 'PRODUCT'].map((value) => ({
                      value,
                      label: t(`itemType.${value}`),
                    }))}
                  />
                  <Input
                    aria-label={t('catalogRecordId')}
                    placeholder={t('catalogRecordId')}
                    maxLength={25}
                    value={itemId}
                    onChange={(event) => {
                      setItemId(event.target.value);
                      changed();
                    }}
                  />
                  <Input
                    aria-label={t('purchaseRecordId')}
                    placeholder={t('purchaseRecordId')}
                    maxLength={25}
                    value={purchaseId}
                    onChange={(event) => {
                      setPurchaseId(event.target.value);
                      changed();
                    }}
                  />
                </>
              ) : (
                <label>
                  {t('feedbackRecord')}
                  <Select
                    aria-label={t('feedbackRecord')}
                    value={selected}
                    onChange={(value) => {
                      setSelected(value);
                      changed();
                    }}
                    showSearch
                    optionFilterProp="label"
                    options={[...targets].map(([value, row]) => ({ value, label: row.name }))}
                  />
                </label>
              )}
            </>
          )}
          <label>
            {t('feedbackNote')}
            <Input.TextArea
              aria-label={t('feedbackNote')}
              value={note}
              maxLength={2000}
              autoSize={{ minRows: 2, maxRows: 5 }}
              onChange={(event) => {
                setNote(event.target.value);
                changed();
              }}
            />
          </label>
          <Button
            htmlType="submit"
            loading={sending}
            disabled={
              kind === 'misunderstood' ? !note.trim() : !target || (manual && !itemId.trim())
            }
          >
            {t('saveFeedback')}
          </Button>
          {message && (
            <Alert
              type={message}
              message={t(message === 'success' ? 'feedbackSaved' : 'feedbackFailed')}
            />
          )}
        </form>
      </details>
      {snapshot.feedback.length > 0 && (
        <details>
          <summary>
            {t('feedbackHistory')} ({snapshot.feedback.length})
          </summary>
          {snapshot.feedback.map((row) => (
            <article key={row.id}>
              <Tag>{t(`feedbackKinds.${row.kind}`)}</Tag>
              <span>
                {t('pendingReview')} · {t('ruleVersion')} {row.ruleVersion}
              </span>
              {row.target && (
                <p>
                  <Link href={assistantRecordHref(row.target.item, row.target.purchase)}>
                    {t('openFeedbackRecord')}
                  </Link>
                </p>
              )}
              {!privacy && row.note && <p>{row.note}</p>}
              <small>
                {t('questionReference')}: {row.questionMessageId} · {row.createdAt}
              </small>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
