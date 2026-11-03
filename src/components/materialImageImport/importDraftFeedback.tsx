'use client';

import { Alert, Button, Space, Tag } from 'antd';
import { useFormatter, useTranslations } from 'next-intl';
import type { useImageImport } from './useImageImport';
import importStyles from './materialImageImport.module.css';

type State = ReturnType<typeof useImageImport>;

export function ImportDraftStatus({ state }: { state: State }) {
  const t = useTranslations('imageImport');
  const format = useFormatter();
  return (
    <span role="status" aria-live="polite">
      {state.saving ? (
        <Tag color="processing">{t('savingDraft')}</Tag>
      ) : state.saveFailed ? (
        <Tag color="error">{t('saveFailed')}</Tag>
      ) : state.dirty || state.recovery ? (
        <Tag color="orange">{t('unsavedTag')}</Tag>
      ) : (
        <Tag color="success">
          {state.savedAt
            ? t('savedAt', {
                time: format.dateTime(new Date(state.savedAt), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
              })
            : t('saved')}
        </Tag>
      )}
    </span>
  );
}

export function ImportDraftFeedback({ state }: { state: State }) {
  const t = useTranslations('imageImport');
  return (
    <>
      {state.recovery && (
        <Alert
          type="warning"
          showIcon
          message={t('backupConflict')}
          description={
            <Space direction="vertical">
              <span>{t('backupConflictHelp')}</span>
              <Space wrap>
                <Button disabled={state.busy} onClick={() => state.resolveRecovery('server')}>
                  {t('useServerDraft')}
                </Button>
                <Button
                  disabled={state.busy || !state.canRecoverLocal}
                  onClick={() => state.resolveRecovery('local')}
                >
                  {t('useLocalDraft')}
                </Button>
                <Button
                  disabled={state.busy}
                  onClick={() => {
                    if (state.job) void state.load(state.job.id);
                  }}
                >
                  {t('checkServerDraft')}
                </Button>
              </Space>
            </Space>
          }
          className={importStyles.notice}
        />
      )}
      {state.restored && (
        <Alert
          type="info"
          showIcon
          message={t('backupRestored')}
          description={t('backupRestoredHelp')}
          className={importStyles.notice}
        />
      )}
      {state.backupFailed && (
        <Alert
          type="warning"
          showIcon
          message={t('backupFailed')}
          description={t('backupFailedHelp')}
          className={importStyles.notice}
        />
      )}
      {state.saveFailed && !state.recovery && (
        <Alert
          type="error"
          showIcon
          message={t('saveFailed')}
          description={t('saveFailedHelp')}
          className={importStyles.notice}
          action={
            <Button disabled={state.busy} onClick={state.save}>
              {t('retrySave')}
            </Button>
          }
        />
      )}
    </>
  );
}
