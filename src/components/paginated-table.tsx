'use client';

import { Empty, Pagination, Skeleton, Spin, Table } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { isValidElement, type ReactNode } from 'react';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { ListLoadingIndicator } from './listLoadingIndicator';
import motionStyles from './listMotion.module.css';
import { useMobile } from './responsive/useMobile';
import mobileStyles from './responsive/responsive.module.css';

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
  mobileRender,
  mobileLayout = 'cards',
  ...props
}: TableProps<RecordType> & {
  /** Optional summary layout for server-paginated records. Desktop table behavior is retained. */
  mobileRender?: (record: RecordType, index: number) => ReactNode;
  mobileLayout?: 'cards' | 'scroll';
}) {
  const defaults = useTablePagination();
  const mobile = useMobile();
  const total = pagination === false ? undefined : (pagination?.total ?? dataSource?.length ?? 0);
  const isLoading = typeof loading === 'object' ? (loading.spinning ?? true) : loading;
  // Let Ant Design retain client sorting, filtering and pagination for ordinary tables.
  // Expansion, selection and grouped headers retain their dedicated table layout.
  const stacked =
    mobile &&
    mobileLayout === 'cards' &&
    !props.expandable &&
    !props.rowSelection &&
    !props.virtual &&
    !props.components &&
    !props.summary &&
    !props.columns?.some((column) => 'children' in column);
  const columns = stacked
    ? props.columns?.map((column) => {
        const cellColumn = column as ColumnType<RecordType>;
        return {
          ...cellColumn,
          width: undefined,
          minWidth: undefined,
          fixed: undefined,
          ellipsis: false,
          render: (value: unknown, record: RecordType, index: number) => {
            const result = cellColumn.render
              ? cellColumn.render(value, record, index)
              : (value as ReactNode);
            const cell =
              result &&
              typeof result === 'object' &&
              !isValidElement(result) &&
              !('$$typeof' in result) &&
              'children' in result
                ? result
                : null;
            const content = (
              <div className={mobileStyles.tableField}>
                <div className={mobileStyles.tableLabel}>
                  {typeof cellColumn.title === 'function' ? null : cellColumn.title}
                </div>
                <div className={mobileStyles.tableValue}>
                  {cell ? cell.children : (result as ReactNode)}
                </div>
              </div>
            );
            return cell ? { ...cell, children: content } : content;
          },
        };
      })
    : props.columns;

  if (mobile && mobileRender) {
    return (
      <Spin
        spinning={Boolean(isLoading && dataSource?.length)}
        indicator={<ListLoadingIndicator />}
      >
        <div className={mobileStyles.recordList} aria-busy={Boolean(isLoading)}>
          {dataSource?.length ? (
            dataSource.map((record, index) => (
              <article
                className={mobileStyles.record}
                key={
                  typeof props.rowKey === 'function'
                    ? props.rowKey(record, index)
                    : String(record[(props.rowKey ?? 'key') as keyof RecordType] ?? index)
                }
              >
                {mobileRender(record, index)}
              </article>
            ))
          ) : isLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : props.locale?.emptyText && typeof props.locale.emptyText !== 'function' ? (
            props.locale.emptyText
          ) : (
            <Empty />
          )}
          {pagination !== false &&
            (total === 0 ? (
              <span>{defaults.showTotal(0)}</span>
            ) : (
              <Pagination
                {...defaults}
                {...pagination}
                total={total}
                simple
                showSizeChanger={false}
                showQuickJumper={false}
                disabled={Boolean(isLoading)}
              />
            ))}
          {footer?.([...(dataSource ?? [])])}
        </div>
      </Spin>
    );
  }

  return (
    <Table<RecordType>
      {...props}
      columns={columns}
      scroll={stacked ? undefined : props.scroll}
      className={[
        motionStyles.surface,
        motionStyles.table,
        isLoading ? motionStyles.pending : motionStyles.ready,
        className,
        stacked && mobileStyles.stackedTable,
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
      pagination={
        pagination === false
          ? false
          : {
              ...defaults,
              ...pagination,
              ...(mobile ? { simple: true, showSizeChanger: false, showQuickJumper: false } : {}),
            }
      }
      // Ant Design omits pagination when total is zero, so keep the count in the footer.
      footer={footer ?? (total === 0 && !isLoading ? () => defaults.showTotal(0) : undefined)}
    />
  );
}
