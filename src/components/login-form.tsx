'use client';

import { Button, Form, Input, Typography, Alert } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { signIn } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useState } from 'react';

export function LoginForm() {
  const t = useTranslations('login');
  const common = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(values: { username: string; password: string }) {
    setBusy(true);
    setError(false);
    try {
      const result = await signIn('credentials', { ...values, redirect: false });
      if (result?.error) setError(true);
      else {
        router.replace('/admin/products', { locale });
        router.refresh();
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-brand">
        <span className="brand-mark">C</span>
        <span>{common('brand')}</span>
      </div>
      <section className="login-panel">
        <div className="login-eyebrow">{t('subtitle')}</div>
        <Typography.Title level={2}>{t('title')}</Typography.Title>
        {error && <Alert type="error" showIcon message={t('failed')} className="login-error" />}
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="username" label={t('username')} rules={[{ required: true }]}>
            <Input size="large" prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={t('password')} rules={[{ required: true }]}>
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={busy}>
            {t('submit')}
          </Button>
        </Form>
        <div className="login-languages">
          <Button
            type="text"
            size="small"
            onClick={() => router.replace('/login', { locale: locale === 'zh' ? 'en' : 'zh' })}
          >
            {locale === 'zh' ? 'English' : '中文'}
          </Button>
        </div>
      </section>
    </main>
  );
}
