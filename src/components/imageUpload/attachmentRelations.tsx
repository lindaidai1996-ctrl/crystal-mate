'use client';
import { Tag } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { MaterialBatchAttachment } from '@/lib/client-types';
import styles from './sharedAttachments.module.css';
export function attachmentLocations(item: MaterialBatchAttachment) {
  return [
    ...(item.asset?.distributors.map((a) => a.distributor.name) ?? []),
    ...(item.asset?.batches.map((a) => a.batch.name) ?? []),
  ].join('、');
}
export function AttachmentRelations({ item }: { item: MaterialBatchAttachment }) {
  const t = useTranslations('sharedAttachments');
  if (!item.asset) return null;
  return (
    <div className={styles.links}>
      {item.asset.distributors.map(({ distributor }) => (
        <Link
          key={`d:${distributor.id}`}
          href={`/admin/distributors/${distributor.id}?view=attachments`}
        >
          <Tag>
            {t('distributor')}: {distributor.name}
          </Tag>
        </Link>
      ))}
      {item.asset.batches.map(({ batch }) => (
        <Link key={`b:${batch.id}`} href={`/admin/materials/batches/${batch.id}?view=attachments`}>
          <Tag>
            {t('batch')}: {batch.name}
          </Tag>
        </Link>
      ))}
    </div>
  );
}
