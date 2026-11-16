'use client';

import { ReloadOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useTranslations } from 'next-intl';
import mobileStyles from './responsive.module.css';

export function ResetFiltersButton({ onReset }: { onReset: () => void }) {
  const t = useTranslations('mobile');
  return (
    <Button
      className={mobileStyles.resetFilters}
      autoInsertSpace={false}
      icon={<ReloadOutlined />}
      onClick={onReset}
    >
      {t('resetFilters')}
    </Button>
  );
}
