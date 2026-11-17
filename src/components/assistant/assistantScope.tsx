'use client';

import { useState } from 'react';
import { Alert, Pagination, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AssistantBrowserConversation } from '@/lib/ai-assistant/browser-contracts';
import type { QueryState, Plan } from '@/lib/ai-assistant/orchestration-contracts';
import { assistantRecordHref } from '@/lib/ai-assistant/result-view';
import assistantStyles from './assistantPage.module.css';

function Conditions({ state, patch }: { state?: QueryState | null; patch?: Plan }) {
  const t = useTranslations('assistant');
  const query = state?.query;
  const hard = query?.hard ?? patch?.hard;
  const semantic =
    query?.semantic ?? Object.values(patch?.semantic ?? {}).flatMap((rows) => rows ?? []);
  return (
    <ul className={assistantStyles.conditions}>
      {query && (
        <li>
          {t('subject')}: {t(`subjectType.${query.subject}`)} ·{' '}
          {query.itemTypes.map((type) => t(`itemType.${type}`)).join(' / ')}
        </li>
      )}
      {hard?.purchaseDate && (
        <li>
          {t('purchaseDate')}: [{hard.purchaseDate.from}, {hard.purchaseDate.to})
        </li>
      )}
      {hard?.createdAt && (
        <li>
          {t('createdAt')}: {t(`createdEntity.${hard.createdAt.entity}`)} [{hard.createdAt.from},{' '}
          {hard.createdAt.to})
        </li>
      )}
      {hard?.location && (
        <li>
          {t('location')}: {hard.location.text} · {t(`locationKind.${hard.location.kind}`)}
        </li>
      )}
      {hard?.distributorIds && (
        <li>
          {t('distributor')}:{' '}
          {hard.distributorIds.map((id) => (
            <Link key={id} href={`/admin/distributors/${id}`}>
              {id}{' '}
            </Link>
          ))}
        </li>
      )}
      {hard?.items && (
        <li>
          {t('specifiedRecords')}:{' '}
          {hard.items.map((item) => (
            <Link key={item.id} href={assistantRecordHref(item)}>
              {item.id}{' '}
            </Link>
          ))}
        </li>
      )}
      {hard?.categories && (
        <li>
          {t('categories')}:{' '}
          {hard.categories.map((category) => (
            <span key={category.id}>
              {category.id} (
              {category.includeDescendants ? t('withDescendants') : t('withoutDescendants')}){' '}
            </span>
          ))}
        </li>
      )}
      {hard?.tagIds && (
        <li>
          {t('hardTags')}: {hard.tagIds.join(' / ')}
        </li>
      )}
      {semantic.map((condition, index) => (
        <li key={index}>
          {t(`concept.${condition.concept}`)}: {t(`relation.${condition.relation}`)}{' '}
          {condition.text}
        </li>
      ))}
      {patch?.month && <li>{t(`month.${patch.month}`)}</li>}
      {patch &&
        Object.entries(patch.hard)
          .filter(([, value]) => value === null)
          .map(([field]) => (
            <li key={field}>
              {t('removeCondition')}: {t(`hardField.${field}`)}
            </li>
          ))}
      {patch &&
        Object.entries(patch.semantic)
          .filter(([, rows]) => rows?.length === 0)
          .map(([concept]) => (
            <li key={concept}>
              {t('removeCondition')}: {t(`concept.${concept}`)}
            </li>
          ))}
    </ul>
  );
}

export function AssistantScope({
  snapshot,
  privacy,
}: {
  snapshot: AssistantBrowserConversation;
  privacy: boolean;
}) {
  const t = useTranslations('assistant');
  const [page, setPage] = useState(1);
  const latest = snapshot.latest;
  if (!latest) return null;
  const progress = latest.progress;
  const count = (value: number | null) => (value === null ? t('unknown') : String(value));
  const decisions = progress.decisions.slice((page - 1) * 5, page * 5);
  return (
    <section className={assistantStyles.scope} aria-label={t('scope')}>
      <Typography.Title level={4}>{t('scope')}</Typography.Title>
      {privacy ? (
        <p>{t('privateConditions')}</p>
      ) : snapshot.state ? (
        <Conditions state={snapshot.state} />
      ) : (
        <p>{t('noConfirmedConditions')}</p>
      )}
      <p className={assistantStyles.muted}>{t('scopeBasis')}</p>
      {!privacy && latest.pendingPlan && (
        <details>
          <summary>{t('pendingConditions')}</summary>
          <Conditions patch={latest.pendingPlan} />
        </details>
      )}
      <dl className={assistantStyles.coverage}>
        <div>
          <dt>{t('candidateCoverage')}</dt>
          <dd>
            {count(progress.readCandidates)} / {count(progress.totalCandidates)}
          </dd>
        </div>
        <div>
          <dt>{t('evaluationCoverage')}</dt>
          <dd>
            {progress.evaluation === 'not_required'
              ? t('notRequired')
              : `${count(progress.evaluatedCandidates)} / ${count(progress.totalCandidates)}`}
          </dd>
        </div>
        <div>
          <dt>{t('confirmed')}</dt>
          <dd>{count(progress.included)}</dd>
        </div>
        <div>
          <dt>{t('excluded')}</dt>
          <dd>{count(progress.excluded)}</dd>
        </div>
        <div>
          <dt>{t('uncertain')}</dt>
          <dd>{count(progress.uncertain)}</dd>
        </div>
        <div>
          <dt>{t('notEvaluated')}</dt>
          <dd>{count(progress.notEvaluated)}</dd>
        </div>
        <div>
          <dt>{t('unread')}</dt>
          <dd>{count(progress.unreadCandidates)}</dd>
        </div>
      </dl>
      <p className={assistantStyles.muted}>
        {t('countBasis')}: {t(`countType.${progress.countBasis}`)} · {t('traversal')}:{' '}
        {t(`completion.${progress.traversal}`)} · {t('evaluation')}:{' '}
        {t(`completion.${progress.evaluation}`)}
      </p>
      {!['completed', 'no_results', 'running'].includes(latest.status) && (
        <Alert
          type="warning"
          message={t(`status.${latest.status}`)}
          description={t(`statusHelp.${latest.status}`)}
        />
      )}
      {progress.decisions.length > 0 && (
        <details className={assistantStyles.evidence}>
          <summary>
            {t('evidence')} ({progress.decisions.length})
          </summary>
          {decisions.map((decision) => (
            <article
              key={`${decision.item.type}:${decision.item.id}:${decision.purchase?.id ?? ''}`}
            >
              <Tag>{t(`decision.${decision.status}`)}</Tag>
              <Link href={assistantRecordHref(decision.item, decision.purchase)}>
                {privacy ? t('privateText') : (decision.name ?? decision.item.id)}
              </Link>
              {!privacy && (
                <>
                  <p>{decision.reason}</p>
                  <ul>
                    {decision.evidence.map((entry, index) => (
                      <li key={index}>
                        {t(`evidenceField.${entry.field}`)}:{' '}
                        {entry.value === null
                          ? t('unknown')
                          : Array.isArray(entry.value)
                            ? entry.value.join(' / ') || t('emptyField')
                            : entry.value || t('emptyField')}{' '}
                        <small>
                          ({entry.entity.type} · {entry.entity.id})
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          ))}
          <Pagination
            current={page}
            onChange={setPage}
            pageSize={5}
            total={progress.decisions.length}
            showSizeChanger={false}
            size="small"
          />
        </details>
      )}
      <p className={assistantStyles.muted}>
        {t('versions')}: {latest.metadata.ruleVersion} · {latest.metadata.promptVersion} ·{' '}
        {latest.metadata.relevancePromptVersion}
      </p>
      <p className={assistantStyles.muted}>
        {t('cumulativeBudget', {
          calls: progress.calls,
          tokens: progress.reservedTokens,
          relevanceCalls: progress.relevanceCalls,
          relevanceTokens: progress.relevanceReservedTokens,
        })}
      </p>
    </section>
  );
}
