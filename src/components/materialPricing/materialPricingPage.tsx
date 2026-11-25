'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  App,
  Button,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Tag,
} from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { ResponsiveDrawer } from '@/components/responsive/responsiveDialog';
import { Sensitive } from '@/components/privacyMode';
import { usePathname, useRouter } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import { formatAmount } from '@/lib/format-money';
import {
  pricingGroupSchema,
  pricingRules,
  type PricingGroup,
  type PricingGroupInput,
  type PricingPreview,
  type PricingPublication,
} from '@/lib/material-pricing/contracts';
import pricingStyles from './materialPricingPage.module.css';
import { MaterialPricingNavigation, type MaterialPricingView } from './materialPricingNavigation';
import { MaterialPricingSkeleton } from './materialPricingSkeleton';

type GroupList = {
  items: PricingGroup[];
  materials: { id: string; name: string; pricingGroupId: string | null }[];
};
const presets = ['S925亮银', '清迈银', '精工银'];
const money = (amount: string | null | undefined) =>
  amount == null ? '—' : `¥${formatAmount(amount)}`;

export function MaterialPricingPage({
  initialGroupId,
  view = 'overview',
}: {
  initialGroupId?: string;
  view?: Exclude<MaterialPricingView, 'purchases' | 'analytics'>;
}) {
  const t = useTranslations('materialPricing');
  const common = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { message } = App.useApp();
  const [data, setData] = useState<GroupList>({ items: [], materials: [] });
  const selected = data.items.find((item) => item.id === initialGroupId)?.id ?? data.items[0]?.id;
  const selectGroup = (id: string) => {
    setHistoryPage(1);
    router.replace({ pathname, query: { group: id } }, { scroll: false });
  };
  const [loadedDetail, setDetail] = useState<{
    group: PricingGroup;
    preview: PricingPreview;
    revision: number;
  }>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detailFailedKey, setDetailFailedKey] = useState('');
  const detailKey = `${selected ?? ''}:${revision}`;
  const detail =
    loadedDetail && loadedDetail.group.id === selected && loadedDetail.revision === revision
      ? loadedDetail
      : undefined;
  const detailLoading = !!selected && !detail && detailFailedKey !== detailKey;
  const [editor, setEditor] = useState<{
    id?: string;
    version?: number;
    draft: PricingGroupInput;
  }>();
  const [saving, setSaving] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [loadedHistory, setHistory] = useState<{
    items: PricingPublication[];
    total: number;
    key: string;
  }>({ items: [], total: 0, key: '' });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFailed, setHistoryFailed] = useState(false);
  const historyKey = `${selected ?? ''}:${revision}:${historyPage}`;
  const history = loadedHistory.key === historyKey ? loadedHistory : { items: [], total: 0 };
  const contentLoading =
    loading ||
    detailLoading ||
    (view === 'history' && !!detail && loadedHistory.key !== historyKey && !historyFailed);
  const publishAndEnable = !!detail && !detail.group.publication;
  const errorText = useCallback(
    (error: unknown) =>
      common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
    [common],
  );
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<GroupList>('/api/material-pricing-groups', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setFailed(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          message.error(errorText(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, errorText, message]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    apiFetch<{ group: PricingGroup; preview: PricingPreview }>(
      `/api/material-pricing-groups/${selected}/preview`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setDetail({ ...result, revision });
          setPrice(result.preview.suggestedPrice);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetailFailedKey(`${selected}:${revision}`);
          message.error(errorText(error));
        }
      });
    return () => controller.abort();
  }, [selected, revision, errorText, message]);
  useEffect(() => {
    if (!selected || view !== 'history') return;
    const controller = new AbortController();
    apiFetch<{ items: PricingPublication[]; total: number }>(
      `/api/material-pricing-groups/${selected}/history?page=${historyPage}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setHistory({ ...result, key: `${selected}:${revision}:${historyPage}` });
        setHistoryFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistoryFailed(true);
      });
    return () => controller.abort();
  }, [selected, revision, historyPage, view]);
  const refresh = () => {
    setLoading(true);
    setRevision((value) => value + 1);
  };
  const openEditor = (group?: PricingGroup, name = '') =>
    setEditor(
      group
        ? {
            id: group.id,
            version: group.version,
            draft: {
              name: group.name,
              materialIds: group.materials.map((item) => item.id),
              lossRate: group.lossRate,
              marketLinked: group.marketLinked,
              marketCoefficient: group.marketCoefficient,
              pricingRule: group.pricingRule,
              pricingValue: group.pricingValue,
              enabled: group.enabled,
            },
          }
        : {
            draft: {
              name,
              materialIds: [],
              lossRate: '0',
              marketLinked: true,
              marketCoefficient: '1',
              pricingRule: 'CUSTOM',
              pricingValue: null,
              enabled: false,
            },
          },
    );
  const patch = (fields: Partial<PricingGroupInput>) =>
    setEditor((current) =>
      current ? { ...current, draft: { ...current.draft, ...fields } } : current,
    );
  async function save() {
    if (!editor || !pricingGroupSchema.safeParse(editor.draft).success) {
      message.error(t('invalid'));
      return;
    }
    setSaving(true);
    try {
      const group = await apiFetch<PricingGroup>(
        `/api/material-pricing-groups${editor.id ? `/${editor.id}` : ''}`,
        {
          method: editor.id ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...editor.draft,
            ...(editor.id ? { version: editor.version } : {}),
          }),
        },
      );
      setEditor(undefined);
      selectGroup(group.id);
      refresh();
      message.success(common('saved'));
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  async function publish() {
    if (!detail || price === null) return;
    setSaving(true);
    try {
      await apiFetch(`/api/material-pricing-groups/${detail.group.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          version: detail.group.version,
          fingerprint: detail.preview.fingerprint,
          saleGramPrice: price,
        }),
      });
      refresh();
      message.success(t(publishAndEnable ? 'publishedAndEnabled' : 'published'));
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  const time = (value: string) =>
    new Date(value).toLocaleString(locale === 'en' ? 'en-GB' : 'zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    });
  const metric = (label: string, amount: string | null | undefined, sensitive = true) => {
    const element = (
      <div className={pricingStyles.metric}>
        <span>{label}</span>
        <strong>{money(amount)}</strong>
      </div>
    );
    return sensitive ? <Sensitive key={label}>{element}</Sensitive> : element;
  };
  const pricingValueLabel = editor ? t(`pricingValue_${editor.draft.pricingRule}`) : '';
  const pricingValueUnit =
    editor?.draft.pricingRule === 'PERCENT' || editor?.draft.pricingRule === 'MARGIN'
      ? '%'
      : t('pricePerGramUnit');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {t(
              view === 'overview'
                ? 'title'
                : view === 'distributors'
                  ? 'distributorComparison'
                  : 'history',
            )}
          </h1>
          <p>
            {t(
              view === 'overview'
                ? 'subtitle'
                : view === 'distributors'
                  ? 'comparisonHelp'
                  : 'historyHelp',
            )}
          </p>
        </div>
        <div className={pricingStyles.actions}>
          <Button icon={<ReloadOutlined />} loading={loading || detailLoading} onClick={refresh}>
            {t('refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            {t('newGroup')}
          </Button>
        </div>
      </div>
      <MaterialPricingNavigation active={view} groupId={selected} />
      {failed && (
        <Alert
          type="error"
          showIcon
          message={t('loadError')}
          action={<Button onClick={refresh}>{t('refresh')}</Button>}
        />
      )}
      <div className={pricingStyles.groupToolbar}>
        <label className={pricingStyles.groupPicker}>
          <span>{t('groupName')}</span>
          <Select
            aria-label={t('chooseGroup')}
            placeholder={t('chooseGroup')}
            value={selected}
            loading={loading}
            options={data.items.map((group) => ({ value: group.id, label: group.name }))}
            onChange={selectGroup}
          />
        </label>
        {detail && (
          <>
            <Tag>{t(detail.group.enabled ? 'enabled' : 'disabled')}</Tag>
            <span className={pricingStyles.muted}>
              {t('materialCount', { count: detail.group.materials.length })}
            </span>
            <Button icon={<EditOutlined />} onClick={() => openEditor(detail.group)}>
              {t('configure')}
            </Button>
          </>
        )}
      </div>
      {!loading && data.items.length === 0 && (
        <div className={pricingStyles.actions}>
          <span className={pricingStyles.help}>{t('presets')}</span>
          {presets.map((name) => (
            <Button key={name} onClick={() => openEditor(undefined, name)}>
              {name}
            </Button>
          ))}
        </div>
      )}
      <div className={pricingStyles.layout}>
        <main className={pricingStyles.panel} aria-busy={contentLoading}>
          {contentLoading ? (
            <MaterialPricingSkeleton view={view} label={common('loading')} />
          ) : !detail ? (
            <Empty description={t(selected ? 'loadError' : 'empty')} />
          ) : (
            <>
              {view === 'overview' && (
                <>
                  <div className={pricingStyles.title}>
                    <div>
                      <h2>{detail.group.name}</h2>
                      <p className={pricingStyles.muted}>
                        {t('executionPrice')}: {money(detail.group.publication?.saleGramPrice)} /{' '}
                        {t('gram')}
                      </p>
                    </div>
                  </div>
                  {detail.preview.changed && (
                    <Alert showIcon type="warning" message={t('changed')} />
                  )}
                  {detail.preview.warning && (
                    <Alert
                      showIcon
                      type="warning"
                      message={t(detail.preview.warning)}
                      style={{ marginTop: 12 }}
                    />
                  )}
                  <div className={pricingStyles.metrics}>
                    {metric(t('rawCost'), detail.preview.totals.rawCost)}
                    {metric(t('estimatedCost'), detail.preview.totals.adjustedCost)}
                    {metric(t('suggestedPrice'), detail.preview.suggestedPrice)}
                  </div>
                  <div className={pricingStyles.publish}>
                    <label>
                      <span>{t('pendingPrice')}</span>
                      <InputNumber<string>
                        aria-label={t('pendingPrice')}
                        stringMode
                        min="0"
                        max="9999999999.99"
                        precision={2}
                        value={price}
                        onChange={setPrice}
                      />
                    </label>
                    <Button
                      type="primary"
                      loading={saving}
                      disabled={price === null || detail.preview.totals.adjustedCost === null}
                      onClick={() => void publish()}
                    >
                      {t(publishAndEnable ? 'publishAndEnable' : 'publish')}
                    </Button>
                    <span className={pricingStyles.help}>
                      {t(publishAndEnable ? 'firstPublishHelp' : 'publishHelp')}
                    </span>
                  </div>
                  {price !== null &&
                    detail.preview.suggestedPrice !== null &&
                    Number(price) < Number(detail.preview.suggestedPrice) && (
                      <Sensitive>
                        <Alert type="warning" showIcon message={t('belowSuggestion')} />
                      </Sensitive>
                    )}
                  {!detail.group.enabled && detail.group.publication && (
                    <Alert showIcon type="info" message={t('enableHint')} />
                  )}
                  <Collapse
                    items={[
                      {
                        key: 'rules',
                        label: t('calculation'),
                        children: (
                          <>
                            <div className={pricingStyles.metrics}>
                              {metric(t('recentCost'), detail.preview.recent.rawCost)}
                              {metric(t('replacementCost'), detail.preview.adjustedReplacementCost)}
                              {metric(t('marketPrice'), detail.preview.market?.price, false)}
                            </div>
                            <p className={pricingStyles.help}>
                              <Sensitive>
                                {t('costSummary', {
                                  count: detail.preview.totals.count,
                                  weight: detail.preview.totals.weight,
                                  amount: detail.preview.totals.amount,
                                  rate: detail.group.lossRate,
                                })}
                              </Sensitive>
                            </p>
                            {detail.preview.market && (
                              <p className={pricingStyles.help}>
                                {t('marketTime')}: {time(detail.preview.market.updatedAt)} · Ag(T+D)
                              </p>
                            )}
                            {detail.preview.latest && (
                              <p className={pricingStyles.help}>
                                <Sensitive>
                                  {t('latestPurchase')}: {detail.preview.latest.receivedAt} ·{' '}
                                  {detail.preview.latest.distributorName} ·{' '}
                                  {money(detail.preview.latest.amount)} /{' '}
                                  {detail.preview.latest.weight} {t('gram')}
                                </Sensitive>
                              </p>
                            )}
                            <p className={pricingStyles.help}>{t('estimateHelp')}</p>
                            <p>{t('singleLossHelp')}</p>
                            <p>{t('formulaCost')}</p>
                            <p>{t('formulaMarket')}</p>
                            <p>{t('formulaPricing')}</p>
                          </>
                        ),
                      },
                    ]}
                  />
                </>
              )}
              {view === 'distributors' && (
                <Table
                  size="small"
                  rowKey="id"
                  scroll={{ x: 560 }}
                  dataSource={detail.preview.distributors}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  columns={[
                    { title: t('distributor'), dataIndex: 'name' },
                    { title: t('weight'), dataIndex: 'weight' },
                    {
                      title: t('amount'),
                      render: (_, row) => <Sensitive>{money(row.amount)}</Sensitive>,
                    },
                    {
                      title: t('rawCost'),
                      render: (_, row) => <Sensitive>{money(row.rawCost)}</Sensitive>,
                    },
                    {
                      title: t('estimatedCost'),
                      render: (_, row) => <Sensitive>{money(row.adjustedCost)}</Sensitive>,
                    },
                  ]}
                />
              )}
              {view === 'history' &&
                (historyFailed ? (
                  <Alert
                    type="error"
                    message={t('loadError')}
                    action={<Button onClick={refresh}>{t('refresh')}</Button>}
                  />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={history.items}
                    scroll={{ x: 440 }}
                    pagination={{
                      current: historyPage,
                      total: history.total,
                      pageSize: 20,
                      showSizeChanger: false,
                      onChange: setHistoryPage,
                    }}
                    columns={[
                      { title: t('date'), render: (_, row) => time(row.createdAt) },
                      { title: t('version'), dataIndex: 'version' },
                      {
                        title: t('saleGramPrice'),
                        render: (_, row) => money(row.saleGramPrice),
                      },
                    ]}
                    expandable={{
                      expandedRowRender: (row) => (
                        <Sensitive>
                          <div className={pricingStyles.history}>
                            {t('rawCost')}: {money(row.costBasis.totals.rawCost)} ·{' '}
                            {t('estimatedCost')}: {money(row.costBasis.totals.adjustedCost)} ·{' '}
                            {t('lossRate')}: {row.costBasis.lossRate}%
                            <p>
                              {t('suggestedPrice')}: {money(row.costBasis.suggestedPrice)} ·{' '}
                              {t('replacementCost')}: {money(row.costBasis.adjustedReplacementCost)}
                            </p>
                            <p>
                              {t('pricingRule')}: {t(`rule_${row.costBasis.pricingRule}`)} ·{' '}
                              {t('pricingValue')}: {row.costBasis.pricingValue ?? '—'}
                            </p>
                            {row.costBasis.market && (
                              <p>
                                {t('marketPrice')}: {money(row.costBasis.market.price)} ·{' '}
                                {time(row.costBasis.market.updatedAt)}
                              </p>
                            )}
                          </div>
                        </Sensitive>
                      ),
                    }}
                  />
                ))}
            </>
          )}
        </main>
      </div>
      <ResponsiveDrawer
        title={editor?.id ? t('configure') : t('newGroup')}
        open={!!editor}
        width={680}
        onClose={() => {
          if (!saving) setEditor(undefined);
        }}
        destroyOnHidden
        footer={
          <div className={pricingStyles.actions}>
            <Button onClick={() => setEditor(undefined)} disabled={saving}>
              {common('cancel')}
            </Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              {common('save')}
            </Button>
          </div>
        }
      >
        {editor && (
          <div className={pricingStyles.form}>
            <label className={pricingStyles.wide}>
              <span>{t('groupName')}</span>
              <Input
                maxLength={120}
                value={editor.draft.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className={pricingStyles.wide}>
              <span>{t('linkedMaterials')}</span>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                value={editor.draft.materialIds}
                onChange={(materialIds) => patch({ materialIds })}
                options={data.materials
                  .filter((item) => !item.pricingGroupId || item.pricingGroupId === editor.id)
                  .map((item) => ({ value: item.id, label: item.name }))}
              />
              <span className={pricingStyles.help}>{t('gramOnly')}</span>
            </label>
            <label>
              <span>{t('enabled')}</span>
              <Switch
                checked={editor.draft.enabled}
                disabled={
                  !editor.id || !data.items.find((item) => item.id === editor.id)?.publication
                }
                onChange={(enabled) => patch({ enabled })}
              />
              <span className={pricingStyles.help}>{t('enableHelp')}</span>
            </label>
            <Sensitive>
              <label>
                <span>{t('lossRate')}</span>
                <InputNumber<string>
                  stringMode
                  min="0"
                  max="99.99"
                  precision={2}
                  suffix="%"
                  value={editor.draft.lossRate || null}
                  onChange={(lossRate) => patch({ lossRate: lossRate ?? '' })}
                />
              </label>
            </Sensitive>
            <label>
              <span>{t('marketLinked')}</span>
              <Switch
                checked={editor.draft.marketLinked}
                onChange={(marketLinked) => patch({ marketLinked })}
              />
            </label>
            <Sensitive>
              <label>
                <span>{t('coefficient')}</span>
                <InputNumber<string>
                  stringMode
                  min="0"
                  max="9999.9999"
                  precision={4}
                  disabled={!editor.draft.marketLinked}
                  value={editor.draft.marketCoefficient || null}
                  onChange={(marketCoefficient) =>
                    patch({ marketCoefficient: marketCoefficient ?? '' })
                  }
                />
              </label>
            </Sensitive>
            <Sensitive>
              <label>
                <span>{t('pricingRule')}</span>
                <Select
                  value={editor.draft.pricingRule}
                  options={pricingRules.map((value) => ({ value, label: t(`rule_${value}`) }))}
                  onChange={(pricingRule) => patch({ pricingRule, pricingValue: null })}
                />
              </label>
            </Sensitive>
            <Sensitive>
              <label>
                <span>{pricingValueLabel}</span>
                <InputNumber<string>
                  aria-label={`${pricingValueLabel} (${pricingValueUnit})`}
                  stringMode
                  min="0"
                  max={editor.draft.pricingRule === 'MARGIN' ? '99.99' : '9999999999.99'}
                  precision={2}
                  suffix={pricingValueUnit}
                  value={editor.draft.pricingValue}
                  onChange={(pricingValue) => patch({ pricingValue })}
                />
              </label>
            </Sensitive>
            <p className={`${pricingStyles.wide} ${pricingStyles.help}`}>{t('configHelp')}</p>
          </div>
        )}
      </ResponsiveDrawer>
    </>
  );
}
