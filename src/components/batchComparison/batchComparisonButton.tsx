'use client';

import { LineChartOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import type { ComparisonKind } from '@/lib/batch-comparison-contracts';

export function BatchComparisonButton({
  kind,
  id,
  entries,
  returnTo,
}: {
  kind: ComparisonKind;
  id: string;
  entries: { batchId: string }[];
  returnTo: string;
}) {
  const t = useTranslations('batchComparison');
  const count = new Set(entries.map((entry) => entry.batchId)).size;
  if (count < 2) return null;
  return (
    <Link
      href={withAdminReturnTo(
        `/admin/${kind === 'material' ? 'materials' : 'products'}/${encodeURIComponent(id)}/batch-comparison`,
        returnTo,
      )}
    >
      <Button size="small" icon={<LineChartOutlined />}>
        {t('entry', { count })}
      </Button>
    </Link>
  );
}
