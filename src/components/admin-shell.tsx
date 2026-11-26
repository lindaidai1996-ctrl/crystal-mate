'use client';

import {
  AppstoreOutlined,
  HistoryOutlined,
  ContainerOutlined,
  DeploymentUnitOutlined,
  FolderOutlined,
  GoldOutlined,
  ToolOutlined,
  LogoutOutlined,
  MenuOutlined,
  ExperimentOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
  EyeInvisibleOutlined,
  CommentOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Button,
  ConfigProvider,
  Drawer,
  Layout,
  Menu,
  Select,
  Switch,
  Tooltip,
} from 'antd';
import { signOut } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { startTransition, useRef, useState } from 'react';
import shellStyles from './adminShell.module.css';
import { catalogPath } from '@/lib/catalog-scopes';
import { NavigationGuardProvider, useNavigationGuard } from './navigationGuard';
import type { AccountProfile } from '@/lib/account';
import { imageThumbnailUrl } from '@/lib/image-storage';
import { setPrivacyMode, usePrivacyMode } from './privacyMode';
import { MobileBackToTop } from './responsive/mobileBackToTop';
import { AssistantNavigationContext } from './assistant/assistantNavigation';
import { assistantTheme } from '@/lib/ui-theme';
import { resetListVisit } from '@/lib/session-list-state';

const { Header, Sider, Content } = Layout;

export function AdminShell({
  children,
  account,
  footer,
}: {
  children: React.ReactNode;
  account: AccountProfile;
  footer: React.ReactNode;
}) {
  return (
    <NavigationGuardProvider>
      <AdminShellContent account={account} footer={footer}>
        {children}
      </AdminShellContent>
    </NavigationGuardProvider>
  );
}

function AdminShellContent({
  children,
  account,
  footer,
}: {
  children: React.ReactNode;
  account: AccountProfile;
  footer: React.ReactNode;
}) {
  const { navigate } = useNavigationGuard();
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const privacyMode = usePrivacyMode();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [listVisit, setListVisit] = useState(0);
  function navigateFromMenu(href: string) {
    navigate(() => {
      startTransition(() => {
        resetListVisit();
        // Reset local table state too, including when clicking the current menu item.
        setListVisit((visit) => visit + 1);
        router.push(href);
      });
      setOpen(false);
    });
  }
  const selected = pathname.startsWith('/admin/price-schemes')
    ? 'priceSchemes'
    : pathname.startsWith('/admin/assistant')
      ? 'assistant'
      : pathname.startsWith('/admin/material-pricing')
        ? 'materialPricing'
        : pathname.startsWith('/admin/audit-logs')
          ? 'auditLogs'
          : pathname.startsWith('/admin/account')
            ? 'account'
            : pathname.startsWith('/admin/setting-styles')
              ? 'settingStyles'
              : pathname.startsWith('/admin/categories')
                ? 'categories'
                : pathname.startsWith('/admin/distributors')
                  ? 'distributors'
                  : pathname === '/admin/materials/batches' ||
                      pathname.startsWith('/admin/materials/batches/')
                    ? 'materialBatches'
                    : pathname.startsWith('/admin/materials')
                      ? 'materials'
                      : pathname.startsWith('/admin/tags')
                        ? 'tags'
                        : pathname === catalogPath('cabochons') ||
                            pathname.startsWith(`${catalogPath('cabochons')}/`)
                          ? 'cabochons'
                          : pathname === catalogPath('finished-strands') ||
                              pathname.startsWith(`${catalogPath('finished-strands')}/`)
                            ? 'finishedStrands'
                            : 'products';
  const menu = (
    <Menu
      theme="light"
      selectedKeys={[selected]}
      items={[
        {
          type: 'group',
          label: t('catalogGroup'),
          children: [
            {
              key: 'assistant',
              icon: <CommentOutlined />,
              label: t('assistant'),
              onClick: () => navigateFromMenu('/admin/assistant'),
            },
            {
              key: 'products',
              icon: <AppstoreOutlined />,
              label: t('products'),
              onClick: () => navigateFromMenu('/admin/products'),
            },
            {
              key: 'cabochons',
              icon: <GoldOutlined />,
              label: t('cabochons'),
              onClick: () => navigateFromMenu(catalogPath('cabochons')),
            },
            {
              key: 'finishedStrands',
              icon: <DeploymentUnitOutlined />,
              label: t('finishedStrands'),
              onClick: () => navigateFromMenu(catalogPath('finished-strands')),
            },
            {
              key: 'materials',
              icon: <ExperimentOutlined />,
              label: t('materials'),
              onClick: () => navigateFromMenu('/admin/materials'),
            },
            {
              key: 'priceSchemes',
              icon: <GoldOutlined />,
              label: t('priceSchemes'),
              onClick: () => navigateFromMenu('/admin/price-schemes'),
            },
            {
              key: 'materialPricing',
              icon: <GoldOutlined />,
              label: t('materialPricing'),
              onClick: () => navigateFromMenu('/admin/material-pricing'),
            },
          ],
        },
        {
          type: 'group',
          label: t('managementGroup'),
          children: [
            {
              key: 'auditLogs',
              icon: <HistoryOutlined />,
              label: t('auditLogs'),
              onClick: () => navigateFromMenu('/admin/audit-logs'),
            },
            {
              key: 'distributors',
              icon: <TeamOutlined />,
              label: t('distributors'),
              onClick: () => navigateFromMenu('/admin/distributors'),
            },
            {
              key: 'materialBatches',
              icon: <ContainerOutlined />,
              label: t('materialBatches'),
              onClick: () => navigateFromMenu('/admin/materials/batches'),
            },
            {
              key: 'settingStyles',
              icon: <ToolOutlined />,
              label: t('settingStyles'),
              onClick: () => navigateFromMenu('/admin/setting-styles'),
            },
            {
              key: 'categories',
              icon: <FolderOutlined />,
              label: t('categories'),
              onClick: () => navigateFromMenu('/admin/categories'),
            },
            {
              key: 'tags',
              icon: <TagsOutlined />,
              label: t('tags'),
              onClick: () => navigateFromMenu('/admin/tags'),
            },
          ],
        },
      ]}
    />
  );
  const actions = (
    <div className={shellStyles.actions}>
      <Tooltip title={t('privacyModeHint')}>
        <label className={shellStyles.privacyToggle}>
          <EyeInvisibleOutlined />
          <span className={shellStyles.privacyLabel}>{t('privacyMode')}</span>
          <Switch
            size="small"
            checked={privacyMode}
            onChange={setPrivacyMode}
            aria-label={t('privacyMode')}
          />
        </label>
      </Tooltip>
      {selected !== 'assistant' && (
        <Tooltip title={t('account')}>
          <Button
            icon={<UserOutlined />}
            onClick={() => navigateFromMenu('/admin/account')}
            aria-label={t('account')}
          />
        </Tooltip>
      )}
      <Select
        aria-label={t('language')}
        value={locale}
        onChange={(value) => navigate(() => router.replace(pathname, { locale: value }))}
        options={[
          { value: 'zh', label: '中文' },
          { value: 'en', label: 'English' },
        ]}
        className={shellStyles.language}
      />
      <Tooltip title={t('logout')}>
        <Button
          icon={<LogoutOutlined />}
          onClick={() =>
            navigate(() => {
              void signOut({ callbackUrl: `/${locale}/login` });
            })
          }
          aria-label={t('logout')}
        />
      </Tooltip>
    </div>
  );
  const sidebar = (
    <div className={shellStyles.sidebar}>
      <div className={shellStyles.brand}>
        <span className={shellStyles.brandMark} aria-hidden="true" />
        <div className={shellStyles.brandName}>
          <strong>{t('brand')}</strong>
          <span>CRYSTAL MATE</span>
        </div>
      </div>
      {menu}
      <div className={shellStyles.footer}>
        <button
          type="button"
          className={shellStyles.accountButton}
          onClick={() => navigateFromMenu('/admin/account')}
          aria-label={t('account')}
          aria-current={selected === 'account' ? 'page' : undefined}
        >
          <Avatar
            size={32}
            src={account.avatarUrl ? imageThumbnailUrl(account.avatarUrl) : undefined}
            icon={<UserOutlined />}
          />
          <span className={shellStyles.accountIdentity}>
            <strong>{account.nickname || account.username}</strong>
            <span>{t('account')}</span>
          </span>
        </button>
        {selected === 'assistant' && <div className={shellStyles.assistantSettings}>{actions}</div>}
      </div>
    </div>
  );

  return (
    <ConfigProvider theme={selected === 'assistant' ? assistantTheme : undefined}>
      <Layout
        className={`${shellStyles.layout} ${selected === 'assistant' ? shellStyles.assistantLayout : ''}`}
      >
        <Sider width={216} className={shellStyles.desktopSidebar}>
          {sidebar}
        </Sider>
        <Layout className={shellStyles.workspace}>
          {selected !== 'assistant' && (
            <Header className={shellStyles.header}>
              <Button
                className={shellStyles.mobileMenu}
                icon={<MenuOutlined />}
                aria-label={t('menu')}
                ref={menuButton}
                onClick={() => setOpen(true)}
              />
              <div className={shellStyles.context}>{t(selected)}</div>
              {actions}
            </Header>
          )}
          <Content className={shellStyles.content}>
            <AssistantNavigationContext.Provider
              key={listVisit}
              value={{ menu: sidebar, open, setOpen, buttonRef: menuButton }}
            >
              {children}
            </AssistantNavigationContext.Provider>
          </Content>
          {footer}
        </Layout>
        <MobileBackToTop key={pathname} />
        {selected !== 'assistant' && (
          <Drawer
            title={t('menu')}
            placement="left"
            open={open}
            onClose={() => setOpen(false)}
            width={216}
            afterOpenChange={(visible) => {
              if (!visible) menuButton.current?.focus();
            }}
            styles={{ body: { padding: 0 } }}
            className={shellStyles.drawer}
          >
            {sidebar}
          </Drawer>
        )}
      </Layout>
    </ConfigProvider>
  );
}
