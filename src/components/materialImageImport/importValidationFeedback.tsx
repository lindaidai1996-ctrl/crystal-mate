'use client';

import { Alert, Button } from 'antd';
import { useTranslations } from 'next-intl';
import type { ImportValidation } from '@/lib/materialImageImport/importValidation';
import importStyles from './materialImageImport.module.css';

export function ImportValidationFeedback({
  validation,
  disabled,
  onSelect,
  onSettings,
}: {
  validation: ImportValidation | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onSettings: () => void;
}) {
  const t = useTranslations('imageImport');
  if (!validation || (!validation.settings.length && !validation.items.length)) return null;
  return (
    <Alert
      type="error"
      showIcon
      role="alert"
      message={
        validation.items.length
          ? t('validationTitle', { count: validation.items.length })
          : t('validationSettingsTitle')
      }
      className={importStyles.notice}
      description={
        <ul className={importStyles.validationList}>
          {!!validation.settings.length && (
            <li>
              <Button type="link" disabled={disabled} onClick={onSettings}>
                {t('sharedSettings')}
              </Button>
              <span>
                {validation.settings.map((issue) => t(`validation.${issue.code}`)).join('；')}
              </span>
            </li>
          )}
          {validation.items.map((item) => (
            <li key={item.id}>
              <Button type="link" disabled={disabled} onClick={() => onSelect(item.id)}>
                {t('validationItem', { number: item.number, name: item.name || t('unnamed') })}
              </Button>
              <span>{item.issues.map((issue) => t(`validation.${issue.code}`)).join('；')}</span>
            </li>
          ))}
        </ul>
      }
    />
  );
}
