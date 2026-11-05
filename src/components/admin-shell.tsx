'use client';

import {
  AppstoreOutlined,
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
} from '@ant-design/icons';
import { Button, Drawer, Layout, Menu, Select, Tooltip } from 'antd';
import { signOut } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useState } from 'react';
import { catalogPath } from '@/lib/catalog-scopes';
import { NavigationGuardProvider, useNavigationGuard } from './navigationGuard';

const { Header, Sider, Content } = Layout;

export function AdminShell({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  return (
    <NavigationGuardProvider>
      <AdminShellContent username={username}>{children}</AdminShellContent>
    </NavigationGuardProvider>
  );
}

function AdminShellContent({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  const { navigate } = useNavigationGuard();
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = pathname.startsWith('/admin/setting-styles')
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
      theme="dark"
      selectedKeys={[selected]}
      items={[
        {
          key: 'products',
          icon: <AppstoreOutlined />,
          label: t('products'),
          onClick: () => {
            navigate(() => router.push('/admin/products'));
            setOpen(false);
          },
        },
        {
          key: 'cabochons',
          icon: <GoldOutlined />,
          label: t('cabochons'),
          onClick: () => {
            navigate(() => router.push(catalogPath('cabochons')));
            setOpen(false);
          },
        },
        {
          key: 'finishedStrands',
          icon: <DeploymentUnitOutlined />,
          label: t('finishedStrands'),
          onClick: () => {
            navigate(() => router.push(catalogPath('finished-strands')));
            setOpen(false);
          },
        },
        {
          key: 'materials',
          icon: <ExperimentOutlined />,
          label: t('materials'),
          onClick: () => {
            navigate(() => router.push('/admin/materials'));
            setOpen(false);
          },
        },
        {
          key: 'distributors',
          icon: <TeamOutlined />,
          label: t('distributors'),
          onClick: () => {
            navigate(() => router.push('/admin/distributors'));
            setOpen(false);
          },
        },
        {
          key: 'materialBatches',
          icon: <ContainerOutlined />,
          label: t('materialBatches'),
          onClick: () => {
            navigate(() => router.push('/admin/materials/batches'));
            setOpen(false);
          },
        },
        {
          key: 'settingStyles',
          icon: <ToolOutlined />,
          label: t('settingStyles'),
          onClick: () => {
            navigate(() => router.push('/admin/setting-styles'));
            setOpen(false);
          },
        },
        {
          key: 'categories',
          icon: <FolderOutlined />,
          label: t('categories'),
          onClick: () => {
            navigate(() => router.push('/admin/categories'));
            setOpen(false);
          },
        },
        {
          key: 'tags',
          icon: <TagsOutlined />,
          label: t('tags'),
          onClick: () => {
            navigate(() => router.push('/admin/tags'));
            setOpen(false);
          },
        },
      ]}
    />
  );
  const sidebar = (
    <div className="sidebar-inner">
      <div className="sidebar-brand">
        <span className="brand-mark">C</span>
        <div>
          <strong>{t('brand')}</strong>
          <small>{t('console')}</small>
        </div>
      </div>
      {menu}
      <div className="sidebar-footer">{username}</div>
    </div>
  );

  return (
    <Layout className="admin-layout">
      <Sider width={226} className="desktop-sidebar">
        {sidebar}
      </Sider>
      <Layout>
        <Header className="admin-header">
          <Button
            className="mobile-menu"
            icon={<MenuOutlined />}
            aria-label="Menu"
            onClick={() => setOpen(true)}
          />
          <div className="header-context">{t(selected)}</div>
          <div className="header-actions">
            <Select
              aria-label={t('language')}
              value={locale}
              onChange={(value) => navigate(() => router.replace(pathname, { locale: value }))}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              className="language-select"
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
        </Header>
        <Content className="admin-content">{children}</Content>
      </Layout>
      <Drawer
        placement="left"
        open={open}
        onClose={() => setOpen(false)}
        width={226}
        closable={false}
        styles={{ body: { padding: 0 } }}
        className="mobile-drawer"
      >
        {sidebar}
      </Drawer>
    </Layout>
  );
}
