'use client';

import { AppstoreOutlined, LogoutOutlined, MenuOutlined, TagsOutlined } from '@ant-design/icons';
import { Button, Drawer, Layout, Menu, Select } from 'antd';
import { signOut } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useState } from 'react';

const { Header, Sider, Content } = Layout;

export function AdminShell({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = pathname.startsWith('/admin/categories') ? 'categories' : 'products';
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
            router.push('/admin/products');
            setOpen(false);
          },
        },
        {
          key: 'categories',
          icon: <TagsOutlined />,
          label: t('categories'),
          onClick: () => {
            router.push('/admin/categories');
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
          <div className="header-context">
            {selected === 'products' ? t('products') : t('categories')}
          </div>
          <div className="header-actions">
            <Select
              aria-label={t('language')}
              value={locale}
              onChange={(value) => router.replace(pathname, { locale: value })}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              className="language-select"
            />
            <Button
              icon={<LogoutOutlined />}
              onClick={() => signOut({ callbackUrl: `/${locale}/login` })}
              title={t('logout')}
              aria-label={t('logout')}
            />
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
