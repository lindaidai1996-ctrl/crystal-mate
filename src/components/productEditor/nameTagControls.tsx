'use client';

import { PlusOutlined, ScanOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';

type NameTagControlsProps = {
  matching: boolean;
  error: string | null;
  missingTags: string[];
  matchedCount: number | null;
  cancelled: boolean;
  onRecognize: () => void;
  onCancel: () => void;
  onCreateTag?: () => void;
  disabled?: boolean;
};

export function NameTagActions({
  matching,
  onRecognize,
  onCancel,
  onCreateTag,
  disabled,
  compact = false,
}: Pick<
  NameTagControlsProps,
  'matching' | 'onRecognize' | 'onCancel' | 'onCreateTag' | 'disabled'
> & { compact?: boolean }) {
  const t = useTranslations('nameTagRecognition');
  const tagText = useTranslations('tags');
  const recognizeLabel = matching ? t('cancel') : t('retry');

  return (
    <div className={`editor-tag-actions${compact ? ' editor-tag-actions-compact' : ''}`}>
      <Tooltip title={compact ? recognizeLabel : undefined}>
        <Button
          type={compact ? 'text' : 'default'}
          size={compact ? 'middle' : 'small'}
          icon={matching ? <StopOutlined /> : <ScanOutlined />}
          aria-label={recognizeLabel}
          disabled={disabled}
          onClick={matching ? onCancel : onRecognize}
        >
          {!compact && recognizeLabel}
        </Button>
      </Tooltip>
      {onCreateTag && (
        <Tooltip title={compact ? tagText('new') : undefined}>
          <Button
            type={compact ? 'text' : 'default'}
            size={compact ? 'middle' : 'small'}
            icon={<PlusOutlined />}
            aria-label={tagText('new')}
            disabled={disabled}
            onClick={onCreateTag}
          >
            {!compact && tagText('new')}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

export function NameTagFeedback({
  matching,
  error,
  missingTags,
  matchedCount,
  cancelled,
  showHelp = true,
}: Pick<
  NameTagControlsProps,
  'matching' | 'error' | 'missingTags' | 'matchedCount' | 'cancelled'
> & { showHelp?: boolean }) {
  const t = useTranslations('nameTagRecognition');
  const status = matching
    ? t('matching')
    : cancelled
      ? t('cancelled')
      : matchedCount !== null
        ? t('matched', { count: matchedCount })
        : showHelp
          ? t('help')
          : null;

  if (!status && !error && missingTags.length === 0) return null;

  return (
    <div className="editor-tag-feedback">
      {status && (
        <span className="editor-tag-status" role="status" aria-live="polite">
          {status}
        </span>
      )}
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
    </div>
  );
}

export function NameTagControls(props: NameTagControlsProps) {
  return (
    <div className="editor-tag-controls">
      <NameTagActions {...props} />
      <NameTagFeedback {...props} />
    </div>
  );
}
