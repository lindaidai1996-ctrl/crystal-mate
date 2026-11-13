'use client';

import { UploadOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, App, Avatar, Button, Form, Input, Skeleton, Upload } from 'antd';
import { signOut } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { newPasswordSchema, type AccountProfile } from '@/lib/account';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { imageThumbnailUrl } from '@/lib/image-storage';
import { uploadImage } from './imageUpload/uploadImage';
import { MAX_UPLOAD_BYTES } from './imageUpload/prepareImages';
import accountStyles from './accountPage.module.css';

type PasswordValues = { currentPassword: string; newPassword: string; confirmPassword: string };

export function AccountPage() {
  const t = useTranslations('account');
  const common = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { message } = App.useApp();
  const [profileForm] = Form.useForm<{ nickname: string }>();
  const [passwordForm] = Form.useForm<PasswordValues>();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const errorMessage = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setProfile(await apiFetch<AccountProfile>('/api/account'));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    apiFetch<AccountProfile>('/api/account')
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveProfile(values: { nickname?: string; avatarObjectKey?: string | null }) {
    const updated = await apiFetch<AccountProfile>('/api/account', {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
    setProfile(updated);
    router.refresh();
    message.success(common('saved'));
    return updated;
  }

  async function saveNickname(values: { nickname: string }) {
    setSaving(true);
    try {
      const updated = await saveProfile(values);
      profileForm.setFieldsValue({ nickname: updated.nickname });
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function changeAvatar(file: File | null) {
    if (
      file &&
      (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size < 1 ||
        file.size > MAX_UPLOAD_BYTES)
    ) {
      message.error(t('invalidAvatar'));
      return;
    }
    setUploading(true);
    try {
      const image = file ? await uploadImage(file) : null;
      await saveProfile({ avatarObjectKey: image?.objectKey ?? null });
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function changePassword(values: PasswordValues) {
    setChangingPassword(true);
    try {
      await apiFetch('/api/account/password', { method: 'POST', body: JSON.stringify(values) });
      passwordForm.resetFields();
      setPasswordChanged(true);
      message.success(t('passwordChanged'));
      await signOut({ callbackUrl: `/${locale}/login` });
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('description')}</p>
        </div>
      </div>
      {loading ? (
        <div className={accountStyles.panel}>
          <Skeleton active avatar paragraph={{ rows: 4 }} />
        </div>
      ) : loadError || !profile ? (
        <Alert
          type="error"
          showIcon
          message={t('loadFailed')}
          action={<Button onClick={() => void load()}>{common('retry')}</Button>}
        />
      ) : (
        <div className={accountStyles.sections}>
          <section className={accountStyles.panel} aria-labelledby="account-profile-title">
            <h2 id="account-profile-title">{t('profile')}</h2>
            <p className={accountStyles.description}>{t('profileHelp')}</p>
            <div className={accountStyles.avatarRow}>
              <Avatar
                size={80}
                src={profile.avatarUrl ? imageThumbnailUrl(profile.avatarUrl) : undefined}
                icon={<UserOutlined />}
                alt={t('avatar')}
              />
              <div>
                <div className={accountStyles.avatarActions}>
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    showUploadList={false}
                    maxCount={1}
                    disabled={uploading || saving}
                    beforeUpload={(file) => {
                      void changeAvatar(file);
                      return false;
                    }}
                  >
                    <Button icon={<UploadOutlined />} loading={uploading} disabled={saving}>
                      {t('changeAvatar')}
                    </Button>
                  </Upload>
                  {profile.avatarUrl && (
                    <Button
                      type="text"
                      disabled={uploading || saving}
                      onClick={() => void changeAvatar(null)}
                    >
                      {t('removeAvatar')}
                    </Button>
                  )}
                </div>
                <p className={accountStyles.hint}>{t('avatarHelp')}</p>
              </div>
            </div>
            <Form
              form={profileForm}
              layout="vertical"
              initialValues={{ nickname: profile.nickname }}
              requiredMark={false}
              disabled={saving || uploading}
              onFinish={saveNickname}
            >
              <Form.Item label={t('username')} extra={t('usernameHelp')}>
                <Input value={profile.username} readOnly autoComplete="username" />
              </Form.Item>
              <Form.Item
                name="nickname"
                label={t('nickname')}
                rules={[{ required: true, whitespace: true, max: 40, message: t('nicknameRule') }]}
              >
                <Input
                  maxLength={40}
                  placeholder={t('nicknamePlaceholder')}
                  autoComplete="nickname"
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving} disabled={uploading}>
                {common('save')}
              </Button>
            </Form>
          </section>
          <section className={accountStyles.panel} aria-labelledby="account-password-title">
            <h2 id="account-password-title">{t('password')}</h2>
            <p className={accountStyles.description}>{t('passwordHelp')}</p>
            {passwordChanged ? (
              <Alert
                type="success"
                showIcon
                message={t('passwordChanged')}
                action={
                  <Button onClick={() => void signOut({ callbackUrl: `/${locale}/login` })}>
                    {t('signInAgain')}
                  </Button>
                }
              />
            ) : (
              <Form
                form={passwordForm}
                layout="vertical"
                requiredMark={false}
                disabled={changingPassword}
                onFinish={changePassword}
              >
                <input
                  type="hidden"
                  name="username"
                  value={profile.username}
                  autoComplete="username"
                />
                <Form.Item
                  name="currentPassword"
                  label={t('currentPassword')}
                  rules={[{ required: true, message: t('currentPasswordRequired') }]}
                >
                  <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Form.Item
                  name="newPassword"
                  label={t('newPassword')}
                  extra={t('passwordRule')}
                  rules={[
                    {
                      validator: (_, value: unknown) =>
                        newPasswordSchema.safeParse(value).success
                          ? Promise.resolve()
                          : Promise.reject(new Error(t('passwordRule'))),
                    },
                  ]}
                >
                  <Input.Password autoComplete="new-password" maxLength={72} />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  label={t('confirmPassword')}
                  dependencies={['newPassword']}
                  rules={[
                    { required: true, message: t('confirmPasswordRequired') },
                    ({ getFieldValue }) => ({
                      validator: (_, value: string) =>
                        !value || value === getFieldValue('newPassword')
                          ? Promise.resolve()
                          : Promise.reject(new Error(t('passwordMismatch'))),
                    }),
                  ]}
                >
                  <Input.Password autoComplete="new-password" maxLength={72} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={changingPassword}>
                  {t('password')}
                </Button>
              </Form>
            )}
          </section>
        </div>
      )}
    </>
  );
}
