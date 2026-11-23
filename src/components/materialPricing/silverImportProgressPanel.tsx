'use client';

import { Alert, Button, Progress } from 'antd';
import { useTranslations } from 'next-intl';
import type { SilverImportProgress } from '@/lib/material-pricing-import/contracts';
import ledgerStyles from './procurementLedger.module.css';

export function SilverImportProgressPanel({
  progress,
  busy,
  privacy,
  progressError,
  errorText,
  onResume,
  onBackgroundClose,
}: {
  progress: SilverImportProgress;
  busy: boolean;
  privacy: boolean;
  progressError: string;
  errorText: (error: unknown) => string;
  onResume: () => void;
  onBackgroundClose?: () => void;
}) {
  const t = useTranslations('silverProcurement');
  const processed = progress.completed.length + progress.failures.length;
  const interrupted = progress.status === 'INTERRUPTED';
  const importing = progress.status === 'RUNNING';
  return (
    <section className={ledgerStyles.importProgress} aria-label={t('importProgress')}>
      <div className={ledgerStyles.heading}>
        <strong>
          {t(
            interrupted
              ? 'importInterrupted'
              : importing
                ? 'importRunning'
                : progress.failures.length
                  ? 'importFinishedWithErrors'
                  : 'importComplete',
          )}
        </strong>
        {importing && onBackgroundClose && (
          <Button onClick={onBackgroundClose}>{t('continueInBackground')}</Button>
        )}
      </div>
      <Progress
        percent={Math.floor((processed / progress.rowNumbers.length) * 100)}
        status={
          interrupted || progress.failures.length ? 'exception' : importing ? 'active' : 'success'
        }
      />
      <div className={ledgerStyles.metrics} aria-live="polite">
        <span>{t('processedRows', { count: processed, total: progress.rowNumbers.length })}</span>
        <span>{t('successRows', { count: progress.completed.length })}</span>
        <span>{t('failedRows', { count: progress.failures.length })}</span>
      </div>
      <p className={ledgerStyles.muted}>
        {t(interrupted ? 'importResumeHint' : importing ? 'backgroundHint' : 'importSavedHint')}
      </p>
      {progressError && <Alert type="warning" showIcon message={progressError} />}
      {progress.failures.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('importFailureHint')}
          description={
            <ul className={ledgerStyles.importFailures}>
              {progress.failures.map((failure) => (
                <li key={failure.rowNumber}>
                  #{failure.rowNumber}: {errorText(new Error(failure.code))}
                </li>
              ))}
            </ul>
          }
        />
      )}
      {interrupted && (
        <Button type="primary" disabled={privacy || busy} loading={busy} onClick={onResume}>
          {t('resumeImport')}
        </Button>
      )}
    </section>
  );
}
