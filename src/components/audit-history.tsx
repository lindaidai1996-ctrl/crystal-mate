'use client';

import { Alert, Button, Drawer, Empty, Image, Select, Space, Tag } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client-api';
import { imageThumbnailUrl } from '@/lib/image-storage';
import { PaginatedTable } from './paginated-table';
import {
  auditEntityTypes,
  type AuditEntry,
  type AuditPage,
  type RecordProvenance,
} from '@/lib/audit';
import { usePrivacyMode } from './privacyMode';
import { DateRangeFilter } from './date-range-filter';
import auditStyles from './audit-history.module.css';

const privateField = /price|cost|quote|amount|fee|lossRate|pricingValue|marketCoefficient/i;
const technicalField =
  /^(id|url|sourceUrl|avatarUrl|fileHash|promptVersion|provider|model|width|height|sequence)$/;
const formatTime = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function useRecordProvenance(
  entityType: string,
  items: { id: string; updatedAt?: string }[],
) {
  const [records, setRecords] = useState<Record<string, RecordProvenance>>({});
  const [failed, setFailed] = useState(false);
  const revision = JSON.stringify(items.map((item) => [item.id, item.updatedAt ?? '']));
  useEffect(() => {
    const controller = new AbortController();
    const ids = (JSON.parse(revision) as [string, string][]).map(([id]) => id);
    if (!ids.length) return;
    const groups = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
      ids.slice(index * 100, (index + 1) * 100),
    );
    Promise.all(
      groups.map((group) =>
        apiFetch<RecordProvenance[]>(
          `/api/record-attributions?${new URLSearchParams({ entityType, ids: group.join(',') })}`,
          { signal: controller.signal },
        ),
      ),
    )
      .then((results) => {
        setRecords(Object.fromEntries(results.flat().map((record) => [record.entityId, record])));
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [entityType, revision]);
  return { records, failed };
}

export function RecordAuditSummary({
  entityType,
  entityId,
  record,
  failed = false,
}: {
  entityType: string;
  entityId: string;
  record?: RecordProvenance;
  failed?: boolean;
}) {
  const t = useTranslations('audit');
  const [open, setOpen] = useState(false);
  const person = (actor: RecordProvenance['createdBy']) =>
    actor ? (actor.id === 'SYSTEM' ? t('system') : actor.nickname || actor.username) : t('unknown');
  return (
    <div className={auditStyles.provenance}>
      {failed ? (
        <span>{t('error')}</span>
      ) : (
        <>
          <span>
            {t('creator')}：{record ? person(record.createdBy) : '—'}
          </span>
          <span>
            {t('updater')}：{record ? person(record.updatedBy) : '—'}
          </span>
        </>
      )}
      <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => setOpen(true)}>
        {t('history')}
      </Button>
      <Drawer
        title={t('history')}
        open={open}
        onClose={() => setOpen(false)}
        width="min(960px, 100vw)"
        destroyOnHidden
      >
        {open && <AuditHistory entityType={entityType} entityId={entityId} />}
      </Drawer>
    </div>
  );
}

export function RecordAuditPanel({
  entityType,
  entityId,
  revision,
}: {
  entityType: string;
  entityId: string;
  revision?: string;
}) {
  const { records, failed } = useRecordProvenance(entityType, [
    { id: entityId, updatedAt: revision },
  ]);
  return (
    <RecordAuditSummary
      entityType={entityType}
      entityId={entityId}
      record={records[entityId]}
      failed={failed}
    />
  );
}

export function AuditHistory({ entityType, entityId }: { entityType?: string; entityId?: string }) {
  const t = useTranslations('audit');
  const privacy = usePrivacyMode();
  const [data, setData] = useState<AuditPage>({ items: [], total: 0, actors: [], references: {} });
  const [actorId, setActorId] = useState<string>();
  const [type, setType] = useState<string>();
  const [action, setAction] = useState<string>();
  const [range, setRange] = useState<{ createdFrom?: string; createdTo?: string }>({});
  const [operationId, setOperationId] = useState<string>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<AuditEntry>();
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  Object.entries({
    entityType: operationId ? undefined : (entityType ?? type),
    entityId: operationId ? undefined : entityId,
    actorId,
    action,
    operationId,
    ...range,
  }).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const queryString = query.toString();
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<AuditPage>(`/api/audit-logs?${queryString}`, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryString, revision]);
  function change(update: () => void) {
    update();
    setPage(1);
    setLoading(true);
  }
  function showOperation(item: AuditEntry) {
    change(() => {
      setOperationId(item.operationId);
      setActorId(undefined);
      setAction(undefined);
      setType(undefined);
      setRange({});
    });
  }
  function actionLabel(entry: AuditEntry) {
    if (entry.source.endsWith('/commit') && entry.entityType.includes('Import'))
      return t('committed');
    if (entry.source.endsWith('/bulk'))
      return t(entry.action === 'DELETE' ? 'bulkDelete' : 'bulkUpdate');
    return t(entry.action);
  }
  function value(field: string, raw: unknown) {
    if (privacy && privateField.test(field)) return t('privacyHidden');
    if (raw === undefined || raw === null || raw === '') return t('none');
    if (typeof raw === 'boolean') return t(raw ? 'yes' : 'no');
    if (
      typeof raw === 'string' &&
      ['objectKey', 'coverObjectKey', 'avatarObjectKey', 'sourceKey'].includes(field) &&
      /^images\//.test(raw)
    )
      return (
        <Image
          src={imageThumbnailUrl(raw, 640)}
          alt={t.has(`fields.${field}`) ? t(`fields.${field}`) : field}
          width={140}
        />
      );
    if (typeof raw === 'string' && /^[A-Z_]+$/.test(raw) && t.has(`values.${raw}`))
      return t(`values.${raw}`);
    if (typeof raw === 'string' && field.endsWith('Id'))
      return data.references[raw] ?? t('related');
    if (field === 'priceCents' && typeof raw === 'number') return `¥${(raw / 100).toFixed(2)}`;
    return typeof raw === 'object' ? JSON.stringify(raw, null, 2) : String(raw);
  }
  const fields = detail?.changedFields.filter((field) => !technicalField.test(field)) ?? [];
  return (
    <>
      <div className={auditStyles.filters}>
        <Select
          className={auditStyles.filter}
          aria-label={t('actor')}
          placeholder={t('allActors')}
          allowClear
          value={actorId}
          onChange={(next) => change(() => setActorId(next))}
          options={[
            ...data.actors.map((actor) => ({
              value: actor.id,
              label: actor.nickname ? `${actor.nickname} (${actor.username})` : actor.username,
            })),
            { value: 'SYSTEM', label: t('system') },
          ]}
        />
        {!entityType && (
          <Select
            className={auditStyles.filter}
            aria-label={t('object')}
            placeholder={t('allTypes')}
            allowClear
            value={type}
            onChange={(next) => change(() => setType(next))}
            options={auditEntityTypes.map((name) => ({
              value: name,
              label: t(`entities.${name}`),
            }))}
          />
        )}
        <Select
          className={auditStyles.filter}
          aria-label={t('action')}
          placeholder={t('allActions')}
          allowClear
          value={action}
          onChange={(next) => change(() => setAction(next))}
          options={['INSERT', 'UPDATE', 'DELETE'].map((name) => ({ value: name, label: t(name) }))}
        />
        <DateRangeFilter
          kind="created"
          label={t('time')}
          value={range.createdFrom && range.createdTo ? [range.createdFrom, range.createdTo] : null}
          onChange={(next) =>
            change(() =>
              setRange(
                next?.[0] && next[1]
                  ? {
                      createdFrom: next[0],
                      createdTo: next[1],
                    }
                  : {},
              ),
            )
          }
        />
      </div>
      {operationId && (
        <Alert
          type="info"
          showIcon
          message={t('operationActive')}
          action={
            <Button size="small" onClick={() => change(() => setOperationId(undefined))}>
              {t('clearOperation')}
            </Button>
          }
        />
      )}
      {error ? (
        <Alert
          type="error"
          showIcon
          message={t('error')}
          action={
            <Button
              onClick={() => {
                setLoading(true);
                setRevision((n) => n + 1);
              }}
            >
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <PaginatedTable<AuditEntry>
          rowKey="id"
          mobileRender={(item) => (
            <div data-audit-mobile-row>
              <div className={auditStyles.mobileHeading}>
                <strong>{item.entityLabel}</strong>
                <Tag>{actionLabel(item)}</Tag>
              </div>
              <p className={auditStyles.description}>{t(`entities.${item.entityType}`)}</p>
              <p>
                {item.actorNickname || item.actorUsername || t('system')} ·{' '}
                {formatTime(item.createdAt)}
              </p>
              <Space wrap>
                <Button onClick={() => setDetail(item)}>{t('detail')}</Button>
                <Button onClick={() => showOperation(item)}>{t('sameOperation')}</Button>
              </Space>
            </div>
          )}
          dataSource={data.items}
          loading={loading}
          size="small"
          scroll={{ x: 680 }}
          locale={{ emptyText: <Empty description={t('empty')} /> }}
          pagination={{
            current: page,
            pageSize: 20,
            total: data.total,
            showSizeChanger: false,
            showTotal: (total) => t('total', { count: total }),
            onChange: (next) => {
              setLoading(true);
              setPage(next);
            },
          }}
          columns={[
            { title: t('time'), dataIndex: 'createdAt', width: 165, render: formatTime },
            {
              title: t('actor'),
              width: 130,
              render: (_, item) => (
                <span title={item.actorUsername ?? undefined}>
                  {item.actorNickname || item.actorUsername || t('system')}
                </span>
              ),
            },
            {
              title: t('object'),
              render: (_, item) => (
                <>
                  <div>{item.entityLabel}</div>
                  <small className={auditStyles.description}>
                    {t(`entities.${item.entityType}`)}
                  </small>
                </>
              ),
            },
            {
              title: t('action'),
              width: 75,
              render: (_, item) => (
                <Tag
                  color={
                    item.action === 'DELETE'
                      ? 'red'
                      : item.action === 'INSERT'
                        ? 'green'
                        : 'default'
                  }
                >
                  {actionLabel(item)}
                </Tag>
              ),
            },
            {
              title: t('changes'),
              width: 130,
              render: (_, item) => (
                <Space direction="vertical" size={0}>
                  <Button type="link" size="small" onClick={() => setDetail(item)}>
                    {t('detail')}
                  </Button>
                  <Button type="link" size="small" onClick={() => showOperation(item)}>
                    {t('sameOperation')}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      )}
      <Drawer
        title={t('changes')}
        open={!!detail}
        onClose={() => setDetail(undefined)}
        width="min(640px, 100vw)"
        destroyOnHidden
      >
        {detail && (
          <>
            <p>
              <strong>{detail.entityLabel}</strong>
            </p>
            <p className={auditStyles.description}>
              {detail.actorNickname || detail.actorUsername || t('system')} ·{' '}
              {formatTime(detail.createdAt)} · {actionLabel(detail)}
            </p>
            {detail.action === 'DELETE' && <Alert type="info" message={t('deleted')} />}
            <div className={auditStyles.changes}>
              {fields.map((field) => (
                <div key={field} className={auditStyles.change}>
                  <strong>{t.has(`fields.${field}`) ? t(`fields.${field}`) : field}</strong>
                  {field === 'passwordChanged' ? (
                    <p>{t('passwordEvent')}</p>
                  ) : [
                      'data',
                      'rows',
                      'settings',
                      'warnings',
                      'quoteSnapshot',
                      'purchaseUnitInputs',
                    ].includes(field) ? (
                    <p>{t('contentChanged')}</p>
                  ) : (
                    <div className={auditStyles.changeValues}>
                      <div>
                        <div className={auditStyles.label}>{t('before')}</div>
                        <pre className={auditStyles.value}>
                          {value(field, detail.before?.[field])}
                        </pre>
                      </div>
                      <div>
                        <div className={auditStyles.label}>{t('after')}</div>
                        <pre className={auditStyles.value}>
                          {value(field, detail.after?.[field])}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}

export function AuditHistoryPage() {
  const t = useTranslations('audit');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t('title')}</h1>
          <p className={auditStyles.description}>{t('description')}</p>
        </div>
      </div>
      <AuditHistory />
    </>
  );
}
