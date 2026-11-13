'use client';

import { Alert, Button, Checkbox, ConfigProvider, Form, Input } from 'antd';
import {
  ArrowRightOutlined,
  GlobalOutlined,
  LockOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { signIn } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useState } from 'react';
import loginStyles from './loginForm.module.css';
import { loginTheme } from '@/lib/ui-theme';

export function LoginForm() {
  const t = useTranslations('login');
  const common = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);

  async function submit(values: { username: string; password: string; remember: boolean }) {
    setBusy(true);
    setError(false);
    try {
      const result = await signIn('credentials', {
        ...values,
        remember: values.remember ? 'true' : 'false',
        redirect: false,
      });
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
    <ConfigProvider theme={loginTheme}>
      <main className={loginStyles.screen} data-motion-paused={motionPaused}>
        <div className={loginStyles.atmosphere} aria-hidden="true">
          <div className={loginStyles.sageGlow} />
          <div className={loginStyles.peachGlow} />
          <div className={loginStyles.lightVeil} />
        </div>
        <header className={loginStyles.header}>
          <div className={loginStyles.brand}>
            <span className={loginStyles.brandMark} aria-hidden="true" />
            <span className={loginStyles.brandName}>
              <strong>{common('brand')}</strong>
              <span>CRYSTAL MATE</span>
            </span>
          </div>
          <div className={loginStyles.headerActions}>
            <Button
              type="text"
              className={loginStyles.motionToggle}
              icon={motionPaused ? <PlayCircleOutlined /> : <PauseOutlined />}
              aria-label={motionPaused ? t('resumeMotion') : t('pauseMotion')}
              title={motionPaused ? t('resumeMotion') : t('pauseMotion')}
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((paused) => !paused)}
            />
            <Button
              type="text"
              icon={<GlobalOutlined />}
              onClick={() => router.replace('/login', { locale: locale === 'zh' ? 'en' : 'zh' })}
            >
              {locale === 'zh' ? 'English' : '中文'}
            </Button>
          </div>
        </header>
        <div className={loginStyles.content}>
          <div className={loginStyles.story}>
            <div className={loginStyles.artwork} aria-hidden="true">
              <div className={loginStyles.logoHalo} />
              <div className={loginStyles.orbit} />
              <div className={loginStyles.orbitInner} />
              <div className={loginStyles.logoFloat}>
                <div className={loginStyles.logoArtwork} />
              </div>
              <span className={loginStyles.sparkle} />
              <span className={loginStyles.smallSparkle} />
            </div>
            <div className={loginStyles.storyCopy}>
              <p className={loginStyles.storyEyebrow}>CARE IN EVERY DETAIL</p>
              <p className={loginStyles.storyTitle}>
                {t('storyFirst')}
                <wbr />
                {t('storySecond')}
              </p>
              <p className={loginStyles.storyNote}>{t('storyNote')}</p>
            </div>
          </div>
          <section className={loginStyles.panel} aria-labelledby="login-title">
            <div className={loginStyles.panelHeading}>
              <span className={loginStyles.welcomeMark} aria-hidden="true">
                <span />
              </span>
              <p className={loginStyles.eyebrow}>WELCOME BACK</p>
              <h1 id="login-title">{t('welcome')}</h1>
              <p className={loginStyles.description}>{t('description')}</p>
            </div>
            {error && (
              <Alert type="error" showIcon message={t('failed')} className={loginStyles.error} />
            )}
            <Form
              layout="vertical"
              onFinish={submit}
              requiredMark={false}
              initialValues={{ remember: false }}
              disabled={busy}
            >
              <Form.Item name="username" label={t('username')} rules={[{ required: true }]}>
                <Input
                  size="large"
                  prefix={<UserOutlined />}
                  placeholder={t('usernamePlaceholder')}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item name="password" label={t('password')} rules={[{ required: true }]}>
                <Input.Password
                  size="large"
                  prefix={<LockOutlined />}
                  placeholder={t('passwordPlaceholder')}
                  autoComplete="current-password"
                />
              </Form.Item>
              <Form.Item name="remember" valuePropName="checked" className={loginStyles.remember}>
                <Checkbox>{t('remember')}</Checkbox>
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={busy}
                className={loginStyles.submit}
              >
                <span>{t('submit')}</span>
                {!busy && <ArrowRightOutlined />}
              </Button>
            </Form>
            <p className={loginStyles.panelNote}>{t('subtitle')}</p>
          </section>
        </div>
      </main>
    </ConfigProvider>
  );
}
