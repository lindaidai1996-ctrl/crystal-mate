'use client';

import { Fragment, useState } from 'react';
import { Alert, Pagination } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AnswerDocument } from '@/lib/ai-assistant/answer-document';
import assistantStyles from './assistantPage.module.css';

type DataBlock = Extract<AnswerDocument['blocks'][number], { type: 'data' }>;
function AnswerData({ block }: { block: DataBlock }) {
  const t = useTranslations('assistant');
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(block.rows.length / pageSize)));
  const rows = block.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const value = (cell: DataBlock['rows'][number]['cells'][number]) =>
    cell.href ? <Link href={cell.href}>{cell.text}</Link> : cell.text;
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
  if (privacy) return <p>{t('privateText')}</p>;
  return (
    <div className={assistantStyles.answer}>
      {answer.warnings.map((warning, i) => (
        <Alert key={i} type="warning" message={warning} />
      ))}
      {answer.fallback && <p className={assistantStyles.muted}>{t('answerFallback')}</p>}
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
                <Fragment key={j}>{cell.text}</Fragment>
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
              {time}
            </time>
          ))}
          <p>{t('historicalAnswer')}</p>
        </details>
      )}
    </div>
  );
}
