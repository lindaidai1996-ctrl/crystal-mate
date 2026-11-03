'use client';

import { useRef, useState } from 'react';
import {
  ArrowLeftOutlined,
  EyeOutlined,
  FileExcelOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Empty,
  Image,
  Popconfirm,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useNavigationGuard } from '@/components/navigationGuard';
import type { ExcelRow, ExcelRowInput } from '@/lib/cabochonExcelImport/contracts';
import { sourceStyle } from '@/lib/cabochonExcelImport/styleReview';
import { normalizeExcelRow } from '@/lib/cabochonExcelImport/normalize';
import { ExcelColumnMapping } from './columnMapping';
import { ExcelRowEditor } from './rowEditor';
import { StyleStatus } from './settingStyleField';
import { useExcelImport } from './useExcelImport';
import layout from './excelImport.module.css';

type PreviewRow = ExcelRowInput & {
  receipt?: ExcelRow['receipt'];
  images?: { url: string }[];
  localImages?: { preview: string }[];
};
export function ExcelImportPage({ initialId }: { initialId?: string }) {
  const t = useTranslations('cabochonExcel');
  const state = useExcelImport(initialId);
  const { navigate } = useNavigationGuard();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<ExcelRowInput | null>(null);
  const { job, rows, tags, styles, busy, selected } = state;
  const done = rows.filter((row) => 'receipt' in row && row.receipt).length;
  const valid = (row: ExcelRowInput) => normalizeExcelRow(row, tags, styles).errors.length === 0;
  const ready = rows.filter((row) => !('receipt' in row && row.receipt) && valid(row));
  const selectedCount = ready.filter((row) => selected.includes(row.rowNumber)).length;
  const createdStyleIds = new Set(
    rows.flatMap((row) => {
      const receipt = 'receipt' in row ? (row.receipt as ExcelRow['receipt']) : null;
      return receipt?.settingStyle?.created ? [receipt.settingStyle.id] : [];
    }),
  );
  const pendingStyles = new Map<string, number>();
  for (const row of job ? ready.filter((row) => selected.includes(row.rowNumber)) : rows) {
    if ('receipt' in row && row.receipt) continue;
    const parsed = normalizeExcelRow(row, tags, styles);
    if (
      parsed.magicBoxStyle &&
      !parsed.settingStyleId &&
      !parsed.errors.includes('STYLE_INVALID') &&
      !parsed.errors.includes('STYLE_UNAVAILABLE')
    )
      pendingStyles.set(parsed.magicBoxStyle, (pendingStyles.get(parsed.magicBoxStyle) ?? 0) + 1);
  }
  const pendingDescription = [...pendingStyles]
    .map(([name, count]) => t('styleSummaryItem', { name, count }))
    .join('；');
  const columns: ColumnsType<PreviewRow> = [
    { title: t('row'), dataIndex: 'rowNumber', width: 70, fixed: 'left' },
    {
      title: t('fields.image'),
      width: 100,
      render: (_, row) => {
        const images =
          row.images?.map((image) => image.url) ??
          row.localImages?.map((image) => image.preview) ??
          [];
        return images.length ? (
          <Image.PreviewGroup items={images}>
            <Image
              className={layout.thumbnail}
              width={52}
              height={52}
              src={images[0]}
              alt={t('rowImage', { row: row.rowNumber })}
              preview={{ mask: <EyeOutlined /> }}
            />
            {images.length > 1 && (
              <div className={layout.muted}>{t('imageCount', { count: images.length })}</div>
            )}
          </Image.PreviewGroup>
        ) : (
          '—'
        );
      },
    },
    {
      title: t('productName'),
      width: 210,
      render: (_, row) => (
        <>
          <div>{normalizeExcelRow(row, tags, styles).name}</div>
          {row.receipt && (
            <Link href={`/admin/catalog/cabochons/${row.receipt.productId}`}>
              {row.receipt.code}
            </Link>
          )}
        </>
      ),
    },
    {
      title: t('fields.price'),
      width: 100,
      render: (_, row) => `¥${normalizeExcelRow(row, tags, styles).price}`,
    },
    {
      title: t('cost'),
      width: 150,
      render: (_, row) => {
        const { cost } = normalizeExcelRow(row, tags, styles);
        return (
          <div className={layout.issueList}>
            <span>
              {t('stoneShort')}：{cost?.roughStoneCost ?? '—'}
            </span>
            <span>
              {t('settingShort')}：{cost?.settingCost ?? '—'}
            </span>
          </div>
        );
      },
    },
    {
      title: t('fields.measurement'),
      width: 155,
      render: (_, row) => {
        const { measurement } = normalizeExcelRow(row, tags, styles);
        return measurement
          ? `${measurement.lengthMm} × ${measurement.widthMm} × ${measurement.heightMm}`
          : '—';
      },
    },
    {
      title: t('tagAndStyle'),
      width: 170,
      render: (_, row) => {
        const parsed = normalizeExcelRow(row, tags, styles);
        const styleName = row.receipt?.settingStyle?.name ?? parsed.magicBoxStyle;
        const styleId = row.receipt?.settingStyle?.id ?? parsed.settingStyleId;
        return (
          <div className={layout.issueList}>
            <Space size="small" wrap>
              {parsed.tagIds.length
                ? tags
                    .filter((tag) => parsed.tagIds.includes(tag.id))
                    .map((tag) => <Tag key={tag.id}>{tag.name}</Tag>)
                : '—'}
            </Space>
            {parsed.missingTags.length > 0 && (
              <span>{t('missingTags', { names: parsed.missingTags.join('、') })}</span>
            )}
            <span>{styleName || t('unknown')}</span>
            <StyleStatus
              name={styleName}
              id={styleId}
              created={!!styleId && createdStyleIds.has(styleId)}
            />
          </div>
        );
      },
    },
    {
      title: t('stock'),
      width: 75,
      render: (_, row) => normalizeExcelRow(row, tags, styles).stock,
    },
    {
      title: t('status'),
      width: 225,
      render: (_, row) => {
        if (row.receipt) return <Tag color="success">{t('imported')}</Tag>;
        const { errors, warnings } = normalizeExcelRow(row, tags, styles);
        return (
          <div className={layout.issueList}>
            {!errors.length && <Tag color="processing">{t('ready')}</Tag>}
            {errors.map((issue) => (
              <span key={issue}>{t(`issues.${issue}` as never)}</span>
            ))}
            {warnings.map((issue) => (
              <span key={issue} className={layout.muted}>
                {t(`issues.${issue}` as never)}
              </span>
            ))}
            {state.rowErrors[row.rowNumber] && (
              <span role="alert">{state.rowErrors[row.rowNumber]}</span>
            )}
          </div>
        );
      },
    },
    {
      title: t('actions'),
      fixed: 'right',
      width: 90,
      render: (_, row) => (
        <Button size="small" disabled={busy || !!row.receipt} onClick={() => setEditing(row)}>
          {t('edit')}
        </Button>
      ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <Link href="/admin/catalog/cabochons">
          <Button icon={<ArrowLeftOutlined />} disabled={busy}>
            {t('back')}
          </Button>
        </Link>
      </div>
      <Steps
        size="small"
        current={done === rows.length && rows.length ? 2 : rows.length ? 1 : 0}
        items={[{ title: t('stepFile') }, { title: t('stepReview') }, { title: t('stepImport') }]}
      />
      {state.error && (
        <Alert className={layout.section} type="error" showIcon message={state.error} />
      )}
      {state.progress && (
        <Alert className={layout.section} type="info" showIcon message={state.progress} />
      )}
      <section className={`editor-surface ${layout.section}`}>
        <Space wrap>
          <Button
            icon={<UploadOutlined />}
            loading={busy}
            disabled={!state.catalogReady}
            onClick={() => navigate(() => input.current?.click())}
          >
            {job || state.workbook ? t('replaceFile') : t('chooseFile')}
          </Button>
          <span>{job?.fileName ?? state.fileName}</span>
          {state.workbook && !job && (
            <Select
              aria-label={t('worksheet')}
              value={state.sheetIndex}
              disabled={busy || rows.length > 0}
              options={state.workbook.sheets.map((sheet, index) => ({
                value: index,
                label: sheet.name,
              }))}
              onChange={state.selectSheet}
            />
          )}
          {job && (
            <>
              <Tag>{job.sheetName}</Tag>
              <Button disabled={busy} onClick={() => void state.loadJob(job.id)}>
                {t('refresh')}
              </Button>
            </>
          )}
        </Space>
        <input
          ref={input}
          className={layout.uploadInput}
          type="file"
          accept=".xlsx"
          disabled={busy || !state.catalogReady}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void state.readFile(file);
          }}
        />
        <p className={layout.muted}>{t('fileHelp')}</p>
        <p className={layout.muted}>{t('defaultsHelp')}</p>
      </section>
      {state.sheet && !rows.length && !job && (
        <ExcelColumnMapping
          sheet={state.sheet}
          headerRow={state.headerRow}
          mapping={state.mapping}
          onHeader={state.setHeaderRow}
          onMapping={state.setMapping}
          onPrepare={() => void state.prepare()}
          busy={busy}
        />
      )}
      {!!state.duplicates.length && !job && (
        <Alert
          type="warning"
          showIcon
          message={t('duplicateTitle')}
          description={
            <Space direction="vertical">
              {state.duplicates.map((item) => (
                <Space key={item.id} wrap>
                  <span>
                    {t('historyItem', {
                      file: item.fileName,
                      sheet: item.sheetName,
                      committed: item.committed,
                      total: item.total,
                    })}
                  </span>
                  <Button size="small" disabled={busy} onClick={() => void state.loadJob(item.id)}>
                    {t('continue')}
                  </Button>
                </Space>
              ))}
            </Space>
          }
        />
      )}
      {rows.length > 0 ? (
        <>
          <div className={layout.toolbar}>
            <Button
              disabled={
                busy ||
                !rows.some((row) => row.tagChoice === 'AUTO' && !('receipt' in row && row.receipt))
              }
              onClick={() => void state.matchTags()}
            >
              {t('matchTags')}
            </Button>
            <Space wrap>
              <Tag>{t('totalCount', { count: rows.length })}</Tag>
              <Tag color="processing">{t('readyCount', { count: ready.length })}</Tag>
              <Tag color="success">{t('doneCount', { count: done })}</Tag>
            </Space>
            <Space wrap>
              {!job && (
                <Button disabled={busy} onClick={state.clearPreview}>
                  {t('remap')}
                </Button>
              )}
              {!job &&
                (state.duplicates.length ? (
                  <Popconfirm
                    title={t('createDuplicateTitle')}
                    description={t('createDuplicateHelp')}
                    onConfirm={() => void state.saveDraft()}
                  >
                    <Button type="primary" loading={busy}>
                      {t('saveDraft')}
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button type="primary" loading={busy} onClick={() => void state.saveDraft()}>
                    {t('saveDraft')}
                  </Button>
                ))}
              {job && (
                <Popconfirm
                  title={t('confirmImport', { count: selectedCount })}
                  description={
                    <div className={layout.confirmDescription}>
                      <p>{t('confirmHelp')}</p>
                      {!!pendingStyles.size && (
                        <p>{t('styleConfirmSummary', { styles: pendingDescription })}</p>
                      )}
                    </div>
                  }
                  onConfirm={() => void state.commit()}
                  disabled={!selectedCount || busy}
                >
                  <Button
                    type="primary"
                    icon={<FileExcelOutlined />}
                    loading={busy}
                    disabled={!selectedCount}
                  >
                    {t('importSelected', { count: selectedCount })}
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </div>
          {!!pendingStyles.size && (
            <Alert
              className={layout.styleSummary}
              type="warning"
              showIcon
              message={t(job ? 'styleSelectedSummary' : 'styleSummary', {
                count: pendingStyles.size,
              })}
              description={
                <Space direction="vertical">
                  <span>{t('styleCreateHelp')}</span>
                  {[...pendingStyles].map(([name, count]) => (
                    <span key={name}>{t('styleSummaryItem', { name, count })}</span>
                  ))}
                </Space>
              }
            />
          )}
          <div className={layout.table}>
            <Table<PreviewRow>
              rowKey="rowNumber"
              size="small"
              columns={columns}
              dataSource={rows as PreviewRow[]}
              scroll={{ x: 1445 }}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => state.setSelected(keys.map(Number)),
                getCheckboxProps: (row) => ({ disabled: busy || !!row.receipt || !valid(row) }),
                selections: [Table.SELECTION_ALL, Table.SELECTION_NONE],
              }}
            />
          </div>
          <p className={layout.muted}>{job ? t('savedHelp') : t('draftHelp')}</p>
        </>
      ) : (
        !state.workbook && !job && <Empty description={t('empty')} />
      )}
      {state.history.length > 0 && (
        <section className={layout.history}>
          <h2>{t('history')}</h2>
          <Space direction="vertical" className={layout.fullWidth}>
            {state.history.map((item) => (
              <div key={item.id} className={layout.toolbar}>
                <span>
                  {t('historyItem', {
                    file: item.fileName,
                    sheet: item.sheetName,
                    committed: item.committed,
                    total: item.total,
                  })}
                </span>
                <Tooltip title={item.updatedAt}>
                  <Button
                    disabled={busy || job?.id === item.id}
                    onClick={() => navigate(() => void state.loadJob(item.id))}
                  >
                    {t('continue')}
                  </Button>
                </Tooltip>
              </div>
            ))}
          </Space>
        </section>
      )}
      {editing && (
        <ExcelRowEditor
          key={`${job?.id ?? 'local'}-${editing.rowNumber}`}
          row={editing}
          tags={tags}
          styles={styles}
          createdStyleIds={createdStyleIds}
          sameStyleCount={
            rows.filter(
              (row) =>
                row.rowNumber !== editing.rowNumber &&
                !('receipt' in row && row.receipt) &&
                !!sourceStyle(editing).trim() &&
                sourceStyle(row).trim() === sourceStyle(editing).trim(),
            ).length
          }
          busy={busy}
          onClose={() => setEditing(null)}
          onTagCreated={state.addTag}
          onSave={async (row, applySameStyle) => {
            if (await state.saveRow(row, applySameStyle)) setEditing(null);
          }}
        />
      )}
    </>
  );
}
