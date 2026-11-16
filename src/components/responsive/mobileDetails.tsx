'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useMobile } from './useMobile';
import mobileStyles from './responsive.module.css';

export function MobileDetails({ children, label }: { children: ReactNode; label?: string }) {
  const t = useTranslations('mobile');
  const mobile = useMobile();
  return mobile ? (
    <details className={mobileStyles.details}>
      <summary>{label ?? t('details')}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
