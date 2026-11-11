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
import { useRef, useState } from 'react';
import Image from 'next/image';
import shellStyles from './adminShell.module.css';
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
  const menuButton = useRef<HTMLButtonElement>(null);
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
          type: 'group',
          label: t('catalogGroup'),
          children: [
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
          ],
        },
        {
          type: 'group',
          label: t('managementGroup'),
          children: [
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
          ],
        },
      ]}
    />
  );
  const sidebar = (
    <div className={shellStyles.sidebar}>
      <div className={shellStyles.brand}>
        <Image src="/images/logo-white.png" alt={t('brand')} width={150} height={130} priority />
        <strong>{t('brand')}</strong>
      </div>
      {menu}
      <div className={shellStyles.footer}>{username}</div>
    </div>
  );

  return (
    <Layout className={shellStyles.layout}>
      <Sider width={216} className={shellStyles.desktopSidebar}>
        {sidebar}
      </Sider>
      <Layout className={shellStyles.workspace}>
        <Header className={shellStyles.header}>
          <Button
            className={shellStyles.mobileMenu}
            icon={<MenuOutlined />}
            aria-label={t('menu')}
            ref={menuButton}
            onClick={() => setOpen(true)}
          />
          <div className={shellStyles.context}>{t(selected)}</div>
          <div className={shellStyles.actions}>
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
        </Header>
        <Content className={shellStyles.content}>{children}</Content>
      </Layout>
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
    </Layout>
  );
}
