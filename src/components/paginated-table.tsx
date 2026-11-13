'use client';

import { Table } from 'antd';
import type { TableProps } from 'antd';
import { useTranslations } from 'next-intl';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { ListLoadingIndicator } from './listLoadingIndicator';
import motionStyles from './listMotion.module.css';

export function useTablePagination() {
  const common = useTranslations('common');
  return {
    ...CLIENT_TABLE_PAGINATION,
    showTotal: (total: number) => common('totalItems', { total }),
  };
}

export function PaginatedTable<RecordType extends object>({
  pagination,
  dataSource,
  footer,
  loading,
  className,
  ...props
}: TableProps<RecordType>) {
  const defaults = useTablePagination();
  const total = pagination === false ? undefined : (pagination?.total ?? dataSource?.length ?? 0);
  const isLoading = typeof loading === 'object' ? (loading.spinning ?? true) : loading;

  return (
    <Table<RecordType>
      {...props}
      className={[
        motionStyles.surface,
        motionStyles.table,
        isLoading ? motionStyles.pending : motionStyles.ready,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-loading={Boolean(isLoading)}
      aria-busy={Boolean(isLoading)}
      dataSource={dataSource}
      loading={{
        indicator: <ListLoadingIndicator />,
        delay: 150,
        ...(typeof loading === 'object' ? loading : { spinning: Boolean(loading) }),
      }}
      pagination={pagination === false ? false : { ...defaults, ...pagination }}
      // Ant Design omits pagination when total is zero, so keep the count in the footer.
      footer={footer ?? (total === 0 && !isLoading ? () => defaults.showTotal(0) : undefined)}
    />
  );
}
