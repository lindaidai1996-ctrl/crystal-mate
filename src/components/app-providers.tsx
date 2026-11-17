'use client';

import '@ant-design/v5-patch-for-react-19';
import { App, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { uiTheme } from '@/lib/ui-theme';
import { useTouchFeedback } from '@/components/responsive/useTouchFeedback';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  useTouchFeedback();
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  }, [locale]);
  return (
    <ConfigProvider locale={locale === 'en' ? enUS : zhCN} theme={uiTheme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
