'use client';

import { Button, Grid, Table } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import type { ColumnType, ColumnsType } from 'antd/es/table';
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

/** Reuse the table's formatting and privacy wrappers in a mobile summary. */
export function MobileTableFields<RecordType extends object>({
  columns,
  record,
  index = 0,
  className,
}: {
  columns: ColumnsType<RecordType>;
  record: RecordType;
  index?: number;
  className?: string;
}) {
  return (
    <dl className={[mobileStyles.tableFields, className].filter(Boolean).join(' ')}>
      {columns.map((column, columnIndex) => {
        if ('children' in column || column.hidden) return null;
        const path = Array.isArray(column.dataIndex) ? column.dataIndex : [column.dataIndex];
        const value = path.reduce<unknown>(
          (current, key) =>
            key === undefined || current === null || typeof current !== 'object'
              ? undefined
              : (current as Record<string, unknown>)[String(key)],
          record,
        );
        const result = column.render ? column.render(value, record, index) : (value as ReactNode);
        const cell =
          result &&
          typeof result === 'object' &&
          !isValidElement(result) &&
          !('$$typeof' in result) &&
          'children' in result
            ? result
            : null;
        if (cell?.props?.colSpan === 0 || cell?.props?.rowSpan === 0) return null;
        return (
          <div
            className={mobileStyles.tableField}
            key={String(column.key ?? columnIndex)}
            data-column={
              column.key ?? (typeof column.dataIndex === 'string' ? column.dataIndex : undefined)
            }
          >
            {column.title && typeof column.title !== 'function' && (
              <dt className={mobileStyles.tableLabel}>{column.title}</dt>
            )}
            <dd className={mobileStyles.tableValue}>
              {cell ? cell.children : (result as ReactNode)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
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
  /** Mobile card content. Ant Design still handles sorting, selection, expansion and pagination. */
  mobileRender?: (record: RecordType, index: number) => ReactNode;
  mobileLayout?: 'cards' | 'scroll';
}) {
  const defaults = useTablePagination();
  const mobileText = useTranslations('mobile');
  const mobile = useMobile();
  const screens = Grid.useBreakpoint();
  const total = pagination === false ? undefined : (pagination?.total ?? dataSource?.length ?? 0);
  const isLoading = typeof loading === 'object' ? (loading.spinning ?? true) : loading;
  const stacked =
    mobile &&
    mobileLayout === 'cards' &&
    !props.virtual &&
    !props.components &&
    !props.summary &&
    !props.columns?.some((column) => 'children' in column);
  const visibleColumns = props.columns?.filter(
    (column) =>
      !column.hidden &&
      (!column.responsive || column.responsive.some((breakpoint) => screens[breakpoint])),
  );
  // Keep original columns in Ant Design's pipeline so their sorters and filters still work.
  // Only their body cells are hidden; the first column contains the complete mobile card.
  const columns: ColumnsType<RecordType> | undefined = stacked
    ? [
        {
          key: '__mobile_record',
          render: (_, record, index) =>
            mobileRender ? (
              mobileRender(record, index)
            ) : (
              <MobileTableFields columns={visibleColumns ?? []} record={record} index={index} />
            ),
        },
        ...(props.columns ?? []).map((column) => ({
          ...(column as ColumnType<RecordType>),
          width: undefined,
          minWidth: undefined,
          fixed: undefined,
          ellipsis: false,
          onCell: () => ({ style: { display: 'none' } }),
          render: () => null,
        })),
      ]
    : props.columns;

  return (
    <Table<RecordType>
      {...props}
      columns={columns}
      scroll={stacked ? undefined : props.scroll}
      expandable={
        stacked && props.expandable?.expandedRowRender
          ? {
              ...props.expandable,
              fixed: undefined,
              columnWidth: undefined,
              columnTitle: undefined,
              expandIcon: ({ expanded, expandable, onExpand, record }) =>
                expandable ? (
                  <Button
                    type="text"
                    className={mobileStyles.expandButton}
                    icon={<DownOutlined />}
                    iconPosition="end"
                    aria-label={mobileText(expanded ? 'collapseRows' : 'expandRows')}
                    aria-expanded={expanded}
                    onClick={(event) => {
                      event.stopPropagation();
                      onExpand(record, event);
                    }}
                  >
                    {mobileText(expanded ? 'collapseRows' : 'expandRows')}
                  </Button>
                ) : null,
            }
          : props.expandable
      }
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
              ...(mobile
                ? {
                    simple: true,
                    showSizeChanger: false,
                    showQuickJumper: false,
                    disabled: Boolean(isLoading),
                  }
                : {}),
            }
      }
      // Ant Design omits pagination when total is zero, so keep the count in the footer.
      footer={footer ?? (total === 0 && !isLoading ? () => defaults.showTotal(0) : undefined)}
    />
  );
}
