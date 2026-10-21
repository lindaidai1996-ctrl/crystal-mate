'use client';

import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function CreatePurchaseButton({
  batchId,
  distributorId,
}: {
  batchId?: string;
  distributorId?: string;
}) {
  const t = useTranslations('common');
  const query = {
    ...(batchId ? { batchId } : {}),
    ...(distributorId ? { distributorId } : {}),
  };

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            key: 'product',
            label: <Link href={{ pathname: '/admin/products/new', query }}>{t('addProduct')}</Link>,
          },
          {
            key: 'material',
            label: (
              <Link href={{ pathname: '/admin/materials/new', query }}>{t('addMaterial')}</Link>
            ),
          },
        ],
      }}
    >
      <Button type="primary" icon={<PlusOutlined />}>
        {t('addProductOrMaterial')} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
