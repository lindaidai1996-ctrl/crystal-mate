'use client';

import { ScanOutlined } from '@ant-design/icons';
import { Alert, Button, Space } from 'antd';
import { useTranslations } from 'next-intl';

export function NameTagControls({
  matching,
  error,
  missingTags,
  matchedCount,
  onRecognize,
  disabled,
}: {
  matching: boolean;
  error: string | null;
  missingTags: string[];
  matchedCount: number | null;
  onRecognize: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('nameTagRecognition');
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      <Button
        size="small"
        icon={<ScanOutlined />}
        loading={matching}
        disabled={disabled}
        onClick={onRecognize}
      >
        {t('retry')}
      </Button>
      <span role="status" aria-live="polite">
        {matching
          ? t('matching')
          : matchedCount === null
            ? t('help')
            : t('matched', { count: matchedCount })}
      </span>
      {error && (
        <Alert
          type="warning"
          showIcon
          message={t(t.has(`errors.${error}`) ? `errors.${error}` : 'errors.TAG_MODEL_UNAVAILABLE')}
        />
      )}
      {missingTags.length > 0 && (
        <Alert type="warning" showIcon message={t('missing', { names: missingTags.join('、') })} />
      )}
    </Space>
  );
}
