'use client';

import { Fragment, useState } from 'react';
import { Pagination } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AnswerDocument } from '@/lib/ai-assistant/answer-document';
import assistantStyles from './assistantPage.module.css';
import { formatAssistantTime, formatAssistantTimeText } from './displayTime';

type DataBlock = Extract<AnswerDocument['blocks'][number], { type: 'data' }>;
function AnswerData({ block }: { block: DataBlock }) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(block.rows.length / pageSize)));
  const rows = block.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const value = (cell: DataBlock['rows'][number]['cells'][number]) =>
    cell.href ? (
      <Link href={cell.href}>{cell.text}</Link>
    ) : (
      formatAssistantTimeText(cell.text, locale)
    );
  return (
    <>
      {!rows.length ? (
        <p>{t('emptyResults')}</p>
      ) : block.format === 'names' ? (
        <p className={assistantStyles.nameLinks}>
          {rows.map((row, i) => (
            <Fragment key={row.id}>
              {i > 0 && '、'}
              {row.cells.map((cell, j) => (
                <Fragment key={j}>{value(cell)}</Fragment>
              ))}
            </Fragment>
          ))}
        </p>
      ) : block.format === 'table' ? (
        <div
          className={assistantStyles.answerTable}
          tabIndex={0}
          role="region"
          aria-label={t('answerTable')}
        >
          <table>
            <thead>
              <tr>
                {block.fields.map((field) => (
                  <th key={field} scope="col">
                    {t(`answerFields.${field}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, j) => (
                    <td key={j}>{value(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className={assistantStyles.answerList}>
          {rows.map((row) => (
            <li key={row.id}>
              {row.cells.map((cell, j) => (
                <Fragment key={j}>
                  {j > 0 && ' · '}
                  {block.fields[j] !== 'name' && `${t(`answerFields.${block.fields[j]}`)}：`}
                  {value(cell)}
                </Fragment>
              ))}
            </li>
          ))}
        </ul>
      )}
      {block.rows.length > pageSize && (
        <Pagination
          size="small"
          current={currentPage}
          pageSize={pageSize}
          total={block.rows.length}
          showSizeChanger={false}
          onChange={setPage}
          responsive
        />
      )}
    </>
  );
}
export function AssistantAnswer({ answer, privacy }: { answer: AnswerDocument; privacy: boolean }) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  if (privacy) return <p>{t('privateText')}</p>;
  // Keep completeness limits visible even when other source notes are collapsed.
  const primaryNoteIndex = Math.max(
    0,
    answer.warnings.findIndex(
      (warning) => warning.includes('待确认') || warning.includes('未完成'),
    ),
  );
  const otherNotes = answer.warnings.filter((_, index) => index !== primaryNoteIndex);
  return (
    <div className={assistantStyles.answer}>
      {answer.warnings.length > 0 && (
        <aside className={assistantStyles.answerNotices} aria-label={t('resultNotes')}>
          <p role="note">{formatAssistantTimeText(answer.warnings[primaryNoteIndex], locale)}</p>
          {otherNotes.length > 0 && (
            <details>
              <summary>{t('moreResultNotes', { count: otherNotes.length })}</summary>
              <ul>
                {otherNotes.map((warning, i) => (
                  <li key={i}>{formatAssistantTimeText(warning, locale)}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      )}
      {answer.fallback && <p className={assistantStyles.answerCaption}>{t('answerFallback')}</p>}
      {answer.blocks.map((block, i) =>
        block.type === 'data' ? (
          <AnswerData key={i} block={block} />
        ) : (
          <p key={i}>
            {block.type === 'advice' && <strong>{t('referenceAdvice')}： </strong>}
            {block.cells.map((cell, j) =>
              cell.href ? (
                <Link key={j} href={cell.href}>
                  {cell.text}
                </Link>
              ) : (
                <Fragment key={j}>{formatAssistantTimeText(cell.text, locale)}</Fragment>
              ),
            )}
          </p>
        ),
      )}
      {answer.observations.length > 0 && (
        <details className={assistantStyles.answerSources}>
          <summary>{t('answerSources')}</summary>
          {answer.observations.map((time) => (
            <time key={time} dateTime={time}>
              {formatAssistantTime(time, locale)}
            </time>
          ))}
          <p>{t('historicalAnswer')}</p>
        </details>
      )}
    </div>
  );
}
