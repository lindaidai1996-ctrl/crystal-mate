'use client';

import '@ant-design/v5-patch-for-react-19';
import { App, ConfigProvider, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';

export function AppProviders({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  }, [locale]);
  return (
    <ConfigProvider
      locale={locale === 'en' ? enUS : zhCN}
      theme={{
        cssVar: { key: 'crystal-mate' },
        token: {
          colorPrimary: theme.defaultSeed.colorPrimary,
          colorBgLayout: '#f5f7fb',
          colorText: '#213047',
          colorTextSecondary: '#66758b',
          colorBorderSecondary: '#e3e9f1',
          colorFillAlter: '#f3f6fa',
          borderRadius: 6,
          fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
