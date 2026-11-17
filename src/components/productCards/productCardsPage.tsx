'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Alert, Button, Checkbox, Empty, Input, Modal, Select, Skeleton, Tag } from 'antd';
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { Link, useRouter } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import {
  CARD_TEMPLATE_VERSION,
  cardErrorMessages,
  cardSaveSchema,
  cardTemplateNames,
  cardTemplates,
  type CardCollection,
  type CardSaveInput,
  type CardSource,
  type ProductCardView,
} from '@/lib/product-cards/contracts';
import { CardImages } from './cardImages';
import { CardBrandEditor } from './cardBrand';
import { ImageSkeleton } from '@/components/loadingImage';
import cardStyles from './productCards.module.css';

function inputForCard(card: ProductCardView): CardSaveInput {
  return {
    title: card.title,
    template: card.template,
    displayName: card.displayName,
    mainMaterials: card.mainMaterials,
    philosophy: card.philosophy,
    images: card.images,
    includeDetails: card.includeDetails,
    brand: card.brand,
    runId: card.runId,
    version: card.version,
    ...(card.source ? { expectedSourceHash: card.source.hash } : {}),
  };
}
function errorText(error: unknown) {
  return (
    cardErrorMessages[error instanceof ClientApiError ? error.code : ''] ?? '操作失败，请稍后重试。'
  );
}
const partNames = {
  name: '商品名称',
  materials: '主要物料',
  images: '商品图片',
  quote: '整份对客报价',
};
function sourceSummary(source: CardSource | null, part: keyof typeof partNames) {
  if (!source) return '来源制作记录已删除，保留名片快照';
  if (part === 'name') return source.name;
  if (part === 'materials') return source.materials.join(' · ') || '暂无物料';
  if (part === 'images') return `${source.images.length} 张商品图片，更新时取前三张`;
  return source.quote
    ? `单件合计 ${source.quote.currency} ${source.quote.total}，${source.quote.rows.length} 项明细`
    : '对客报价不完整';
}

export function ProductCardsPage({ productId, returnTo }: { productId: string; returnTo: string }) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [collection, setCollection] = useState<CardCollection | null>(null);
  const [current, setCurrent] = useState<ProductCardView | null>(null);
  const [draft, setDraft] = useState<CardSaveInput | null>(null);
  const [baseline, setBaseline] = useState('');
  const [source, setSource] = useState<CardSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewSignature, setPreviewSignature] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [freshSource, setFreshSource] = useState<CardSource | null>(null);
  const [refreshParts, setRefreshParts] = useState<(keyof typeof partNames)[]>([]);
  const [savingBrand, setSavingBrand] = useState(false);
  const previewAbort = useRef<AbortController | null>(null);
  const blobUrl = useRef('');
  const editorGeneration = useRef(0);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);

  const load = useCallback(async () => {
    const data = await apiFetch<CardCollection>(`/api/products/${productId}/cards`);
    setCollection(data);
    return data;
  }, [productId]);
  useEffect(() => {
    let active = true;
    apiFetch<CardCollection>(`/api/products/${productId}/cards`)
      .then((data) => {
        if (active) {
          setCollection(data);
          setLoadError('');
        }
      })
      .catch((error) => {
        if (active) setLoadError(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      previewAbort.current?.abort();
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, [productId]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  function changeEditor(action: () => void) {
    if (dirty)
      modal.confirm({
        title: '放弃尚未保存的修改？',
        content: '当前修改尚未保存到名片。',
        okText: '放弃修改',
        cancelText: '继续编辑',
        onOk: action,
      });
    else action();
  }
  function clearPreview() {
    previewAbort.current?.abort();
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = '';
    setPreviewUrl('');
    setPreviewSignature('');
    setPreviewError('');
    setPreviewing(false);
  }
  async function preview(input = draft, card = current) {
    if (!input) return;
    const parsed = cardSaveSchema.safeParse(input);
    if (!parsed.success) {
      setPreviewError('请填写名片标题、商品名称，并选择 1–3 张商品图。');
      return;
    }
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    setPreviewing(true);
    setPreviewError('');
    try {
      const response = await fetch('/api/product-cards/preview', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          ...(card ? { cardId: card.id } : {}),
          input: parsed.data,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ClientApiError(body.error ?? 'SERVER_ERROR');
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = URL.createObjectURL(blob);
      setPreviewUrl(blobUrl.current);
      setPreviewSignature(JSON.stringify(input));
    } catch (error) {
      if (!controller.signal.aborted) setPreviewError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setPreviewing(false);
    }
  }
  function openCard(card: ProductCardView) {
    editorGeneration.current++;
    const input = inputForCard(card);
    clearPreview();
    setCurrent(card);
    setDraft(input);
    setBaseline(JSON.stringify(input));
    setSource(card.source);
    setCandidates([]);
    void preview(input, card);
  }
  function newCard(data = collection) {
    if (!data?.source) {
      message.info('请先为商品添加一条 DIY 制作记录。');
      return;
    }
    editorGeneration.current++;
    const initial: CardSaveInput = {
      title: `${data.source.name} · 名片`.slice(0, 80),
      template: 'natural',
      displayName: data.source.name,
      mainMaterials: data.source.materials,
      philosophy: '',
      images: data.source.images
        .slice(0, 3)
        .map((image) => ({ sourceImageId: image.id, framing: { mode: 'contain' } })),
      includeDetails: false,
      brand: structuredClone(data.brand),
      runId: data.source.runId,
      expectedSourceHash: data.source.hash,
    };
    clearPreview();
    setCurrent(null);
    setDraft(initial);
    setBaseline('');
    setSource(data.source);
    setCandidates([]);
    if (initial.images.length) void preview(initial, null);
  }
  function update(patch: Partial<CardSaveInput>) {
    setDraft((value) => (value ? { ...value, ...patch } : value));
  }
  async function changeRun(runId: string) {
    setBusy('source');
    try {
      const data = await apiFetch<CardCollection>(
        `/api/products/${productId}/cards?runId=${encodeURIComponent(runId)}`,
      );
      setSource(data.source);
      update({ runId, expectedSourceHash: data.source?.hash, refresh: undefined });
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setBusy('');
    }
  }
  async function save(): Promise<ProductCardView | null> {
    if (!draft) return null;
    const parsed = cardSaveSchema.safeParse(draft);
    if (!parsed.success) {
      message.error('请检查必填内容、文字长度，并选择 1–3 张商品图。');
      return null;
    }
    const saved = await apiFetch<ProductCardView>(
      current ? `/api/product-cards/${current.id}` : `/api/products/${productId}/cards`,
      { method: current ? 'PUT' : 'POST', body: JSON.stringify(parsed.data) },
    );
    const next = inputForCard(saved);
    setCurrent(saved);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setSource(saved.source);
    await load();
    return saved;
  }
  async function saveOrDownload(download: boolean) {
    if (download && draft && (!draft.mainMaterials.length || !draft.philosophy.trim())) {
      message.info(cardErrorMessages.CARD_CONTENT_INCOMPLETE);
      return;
    }
    setBusy(download ? 'download' : 'save');
    try {
      const saved =
        current && !dirty && current.templateVersion === CARD_TEMPLATE_VERSION
          ? current
          : await save();
      if (!saved) return;
      if (!download) {
        message.success('名片已保存');
        void preview(inputForCard(saved), saved);
        return;
      }
      const response = await fetch(`/api/product-cards/${saved.id}/png?download=1`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ClientApiError(body.error ?? 'SERVER_ERROR');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${saved.title.replace(/[\\/:*?"<>|]/g, '-')}.png`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      message.success('名片已保存，PNG 已导出');
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setBusy('');
    }
  }
  async function generateCopy() {
    if (!draft?.displayName.trim()) {
      message.info('请先填写商品名称。');
      return;
    }
    const input = {
      displayName: draft.displayName,
      mainMaterials: draft.mainMaterials,
      template: draft.template,
    };
    const generation = editorGeneration.current;
    setGenerating(true);
    try {
      const result = await apiFetch<{ candidates: string[] }>('/api/product-cards/copywriting', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const latest = draftRef.current;
      if (generation !== editorGeneration.current || !latest) return;
      if (
        JSON.stringify(input) !==
        JSON.stringify({
          displayName: latest.displayName,
          mainMaterials: latest.mainMaterials,
          template: latest.template,
        })
      ) {
        message.info('名称、物料或风格已变化，请重新生成文案。');
        return;
      }
      setCandidates(result.candidates);
    } catch (error) {
      if (generation === editorGeneration.current) message.error(errorText(error));
    } finally {
      setGenerating(false);
    }
  }
  async function showRefresh() {
    if (!draft?.runId) {
      message.info('来源制作记录已删除，请选择其他制作记录。');
      return;
    }
    setBusy('refresh');
    try {
      const data = await apiFetch<CardCollection>(
        `/api/products/${productId}/cards?runId=${encodeURIComponent(draft.runId)}`,
      );
      setFreshSource(data.source);
      setRefreshParts(
        current?.changed.length ? current.changed : ['name', 'materials', 'images', 'quote'],
      );
      setRefreshing(true);
    } catch (error) {
      message.error(errorText(error));
    } finally {
      setBusy('');
    }
  }
  function applyRefresh() {
    if (!draft || !freshSource) return;
    update({
      expectedSourceHash: freshSource.hash,
      refresh: [...new Set([...(draft.refresh ?? []), ...refreshParts])],
      ...(refreshParts.includes('name') ? { displayName: freshSource.name } : {}),
      ...(refreshParts.includes('materials') ? { mainMaterials: freshSource.materials } : {}),
      ...(refreshParts.includes('images')
        ? {
            images: freshSource.images
              .slice(0, 3)
              .map((image) => ({ sourceImageId: image.id, framing: { mode: 'contain' as const } })),
          }
        : {}),
    });
    setSource(freshSource);
    setRefreshing(false);
  }
  const quote =
    current && current.runId === draft?.runId && !draft?.refresh?.includes('quote')
      ? current.quote
      : (source?.quote ?? null);
  const stalePreview = Boolean(draft && previewSignature !== JSON.stringify(draft));

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (loadError)
    return (
      <Alert
        type="error"
        showIcon
        message={loadError}
        action={
          <Button
            onClick={() => {
              setLoadError('');
              setLoading(true);
              void load()
                .catch((error) => setLoadError(errorText(error)))
                .finally(() => setLoading(false));
            }}
          >
            重试
          </Button>
        }
      />
    );
  return (
    <div className={cardStyles.page}>
      <header className={cardStyles.header}>
        <div>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => changeEditor(() => router.push(returnTo))}
          >
            返回商品
          </Button>
          <h1>
            商品名片<span>让作品，也有自己的表达</span>
          </h1>
        </div>
        <Button
          icon={<PlusOutlined />}
          onClick={() => changeEditor(() => newCard())}
          disabled={!collection?.source || Boolean(busy)}
        >
          新建名片
        </Button>
      </header>
      <div className={cardStyles.savedCards} aria-label="已保存的名片">
        {collection?.items.map((card) => (
          <button
            type="button"
            key={card.id}
            className={current?.id === card.id ? cardStyles.activeCard : ''}
            disabled={Boolean(busy)}
            onClick={() => changeEditor(() => openCard(card))}
          >
            <span className={`${cardStyles.swatch} ${cardStyles[card.template]}`} />
            <span>
              <strong>{card.title}</strong>
              <small>
                {cardTemplateNames[card.template]} ·{' '}
                {new Date(card.updatedAt).toLocaleDateString('zh-CN')}
              </small>
            </span>
          </button>
        ))}
        {!collection?.items.length && (
          <p className={cardStyles.help}>还没有保存的名片。为这件作品创建第一份名片吧。</p>
        )}
      </div>
      {!draft ? (
        <div className={cardStyles.welcome}>
          <span className={cardStyles.eyebrow}>A LITTLE STORY OF YOUR CREATION</span>
          <h2>一件作品，三种表达。</h2>
          <p>选择图片、写下一段心意，再将作品与它的故事一起交给客户。</p>
          <div className={cardStyles.templateIntro}>
            {cardTemplates.map((template) => (
              <div key={template} className={cardStyles[template]}>
                <span>{cardTemplateNames[template]}</span>
                <i />
                <strong>
                  {template === 'natural'
                    ? '温润，自有光'
                    : template === 'editorial'
                      ? 'THE HANDMADE EDIT'
                      : '一物 · 一念'}
                </strong>
              </div>
            ))}
          </div>
          {collection?.source ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => newCard()}>
              创建商品名片
            </Button>
          ) : (
            <Alert
              type="info"
              showIcon
              message="请先配置 DIY 制作记录，再创建名片。"
              action={
                <Link
                  href={`/admin/products/${productId}?returnTo=${encodeURIComponent(`/admin/products/${productId}/cards`)}`}
                >
                  编辑 DIY 配置
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <div className={cardStyles.workspace}>
          <section className={cardStyles.editor} aria-label="名片配置">
            <div className={cardStyles.editorHeading}>
              <h2>{current ? '编辑名片' : '新建名片'}</h2>
              <Tag color={dirty ? 'gold' : 'green'}>{dirty ? '尚未保存' : '已保存'}</Tag>
            </div>
            {current?.changed.length ? (
              <Alert
                type="info"
                showIcon
                message="来源数据已更新"
                description={`${current.changed.map((part) => partNames[part]).join('、')}有变化，当前仍保留已保存的名片内容。`}
              />
            ) : null}
            {current && !source && (
              <Alert
                type="warning"
                showIcon
                message="来源制作记录已删除，现有名片仍可编辑和导出。"
              />
            )}
            <fieldset disabled={Boolean(busy)} className={cardStyles.fields} inert={Boolean(busy)}>
              <label className={cardStyles.label}>
                名片标题
                <Input
                  maxLength={80}
                  value={draft.title}
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder="用于区分不同名片，不印在图片上"
                />
              </label>
              <div className={cardStyles.label}>
                制作记录
                <Select
                  aria-label="制作记录"
                  value={draft.runId}
                  onChange={(value) => void changeRun(value)}
                  options={collection?.sources.map((run, index) => ({
                    value: run.runId,
                    label: `${index === 0 ? '最新 · ' : ''}${new Date(run.createdAt).toLocaleString('zh-CN')} · ${run.quantity} 件`,
                  }))}
                />
              </div>
              <Button block icon={<ReloadOutlined />} onClick={() => void showRefresh()}>
                更新商品数据
              </Button>
              <div className={cardStyles.sectionTitle}>
                <span>01</span>
                <h3>选择表达方式</h3>
              </div>
              <div className={cardStyles.templateChoices}>
                {cardTemplates.map((template) => (
                  <button
                    type="button"
                    key={template}
                    aria-pressed={draft.template === template}
                    className={`${cardStyles[template]} ${draft.template === template ? cardStyles.selectedTemplate : ''}`}
                    onClick={() => update({ template })}
                  >
                    <i />
                    <strong>{cardTemplateNames[template]}</strong>
                    <small>
                      {template === 'natural'
                        ? '暖白 · 墨绿 · 温润'
                        : template === 'editorial'
                          ? '大图 · 强标题 · 节奏'
                          : '纸色 · 留白 · 诗意'}
                    </small>
                  </button>
                ))}
              </div>
              <div className={cardStyles.sectionTitle}>
                <span>02</span>
                <h3>作品图片</h3>
              </div>
              <CardImages
                images={draft.images}
                source={source}
                template={draft.template}
                onChange={(images) => update({ images })}
              />
              <div className={cardStyles.sectionTitle}>
                <span>03</span>
                <h3>作品与心意</h3>
              </div>
              <label className={cardStyles.label}>
                商品名称
                <Input
                  maxLength={80}
                  showCount
                  value={draft.displayName}
                  onChange={(event) => update({ displayName: event.target.value })}
                />
              </label>
              <div className={cardStyles.label}>
                主要物料
                <Select
                  mode="tags"
                  aria-label="主要物料"
                  value={draft.mainMaterials}
                  tokenSeparators={['，', ',']}
                  maxCount={12}
                  onChange={(mainMaterials) => update({ mainMaterials })}
                  options={source?.materials.map((name) => ({ value: name, label: name }))}
                  placeholder="选择或输入主要物料"
                />
                <p className={cardStyles.help}>按所选顺序展示；输入后按回车可添加，最多 12 项。</p>
              </div>
              <div className={cardStyles.copyHeading}>
                <label htmlFor="card-philosophy">哲理短文</label>
                <Button
                  type="text"
                  icon={<BulbOutlined />}
                  loading={generating}
                  onClick={() => void generateCopy()}
                >
                  {candidates.length ? '换一组文案' : '生成文案'}
                </Button>
              </div>
              <Input.TextArea
                id="card-philosophy"
                value={draft.philosophy}
                maxLength={180}
                showCount
                autoSize={{ minRows: 3, maxRows: 7 }}
                placeholder="写一段与作品名称呼应的话，也可以生成候选后再修改。"
                onChange={(event) => update({ philosophy: event.target.value })}
              />
              {candidates.length > 0 && (
                <div className={cardStyles.candidates}>
                  {candidates.map((candidate, index) => (
                    <button
                      type="button"
                      key={candidate}
                      aria-label={`使用文案 ${index + 1}`}
                      onClick={() => update({ philosophy: candidate })}
                    >
                      <span>0{index + 1}</span>
                      <p>{candidate}</p>
                    </button>
                  ))}
                </div>
              )}
              <div className={cardStyles.sectionTitle}>
                <span>04</span>
                <h3>对客明细</h3>
              </div>
              <Checkbox
                checked={draft.includeDetails}
                onChange={(event) => update({ includeDetails: event.target.checked })}
              >
                导出完整对客报价明细
              </Checkbox>
              <p className={cardStyles.help}>
                按单件展示物料、银料、手工和其他费用。不勾选时不显示金额。
              </p>
              {draft.includeDetails && !quote && (
                <Alert
                  type="warning"
                  showIcon
                  message="报价不完整，暂时无法导出明细"
                  description="请到 DIY 配置补全，再更新商品数据；也可以取消明细，仅导出作品名片。"
                />
              )}
              {draft.includeDetails && quote && (
                <div className={cardStyles.quoteSummary}>
                  <span>单件对客合计</span>
                  <strong>
                    {quote.currency} {quote.total}
                  </strong>
                  <small>{quote.rows.length} 项费用 · 明细只读</small>
                  <details>
                    <summary>查看全部明细</summary>
                    {quote.rows.map((row, index) => (
                      <div key={index}>
                        <span>
                          {row.name}
                          <small>
                            {row.specification} {row.quantity}
                          </small>
                        </span>
                        <span>
                          {row.unitPrice === null ? '' : `单价 ${row.unitPrice}`}
                          <strong>{row.subtotal}</strong>
                        </span>
                      </div>
                    ))}
                  </details>
                </div>
              )}
              <Link
                href={`/admin/products/${productId}?returnTo=${encodeURIComponent(`/admin/products/${productId}/cards`)}`}
                onClick={(event) => {
                  if (dirty) {
                    event.preventDefault();
                    changeEditor(() =>
                      router.push(
                        `/admin/products/${productId}?returnTo=${encodeURIComponent(`/admin/products/${productId}/cards`)}`,
                      ),
                    );
                  }
                }}
              >
                编辑 DIY 配置
              </Link>
              <div className={cardStyles.sectionTitle}>
                <span>05</span>
                <h3>品牌落款</h3>
              </div>
              <CardBrandEditor
                value={draft.brand}
                onChange={(brand) => update({ brand })}
                savingDefaults={savingBrand}
                onSaveDefaults={async () => {
                  setSavingBrand(true);
                  try {
                    const defaults = await apiFetch<{ version: number }>(
                      '/api/product-card-brand',
                      {
                        method: 'PUT',
                        body: JSON.stringify({
                          brand: draft.brand,
                          version: collection?.brandVersion ?? 0,
                        }),
                      },
                    );
                    setCollection((value) =>
                      value
                        ? { ...value, brand: draft.brand, brandVersion: defaults.version }
                        : value,
                    );
                    message.success('品牌默认配置已保存');
                  } catch (error) {
                    message.error(errorText(error));
                  } finally {
                    setSavingBrand(false);
                  }
                }}
              />
            </fieldset>
            <div className={cardStyles.saveActions}>
              <Button
                icon={<SaveOutlined />}
                loading={busy === 'save'}
                disabled={Boolean(busy)}
                onClick={() => void saveOrDownload(false)}
              >
                保存名片
              </Button>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={busy === 'download'}
                disabled={Boolean(busy) || (draft.includeDetails && !quote)}
                onClick={() => void saveOrDownload(true)}
              >
                保存并导出 PNG
              </Button>
            </div>
            {current && (
              <div className={cardStyles.secondaryActions}>
                <Button
                  type="text"
                  icon={<CopyOutlined />}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    changeEditor(() => {
                      setBusy('copy');
                      void apiFetch<ProductCardView>(`/api/product-cards/${current.id}/copy`, {
                        method: 'POST',
                        body: JSON.stringify({ version: current.version }),
                      })
                        .then((card) => {
                          openCard(card);
                          void load();
                        })
                        .catch((error) => message.error(errorText(error)))
                        .finally(() => setBusy(''));
                    })
                  }
                >
                  复制已保存的名片
                </Button>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    modal.confirm({
                      title: '删除这份名片？',
                      content: '仅删除名片，不影响商品或 DIY 制作记录。',
                      okText: '删除',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        setBusy('delete');
                        try {
                          await apiFetch(`/api/product-cards/${current.id}`, {
                            method: 'DELETE',
                            body: JSON.stringify({ version: current.version }),
                          });
                          clearPreview();
                          setCurrent(null);
                          setDraft(null);
                          setBaseline('');
                          await load();
                        } catch (error) {
                          message.error(errorText(error));
                        } finally {
                          setBusy('');
                        }
                      },
                    })
                  }
                >
                  删除名片
                </Button>
              </div>
            )}
          </section>
          <aside className={cardStyles.preview} aria-label="PNG 预览">
            <div className={cardStyles.previewHeading}>
              <div>
                <h2>名片预览</h2>
                <p>1080 px 高清竖版{draft.includeDetails ? ' · 含明细长图' : ''}</p>
              </div>
              <Button
                icon={<EyeOutlined />}
                loading={previewing}
                disabled={Boolean(busy)}
                onClick={() => void preview()}
              >
                更新预览
              </Button>
            </div>
            {previewError && <Alert type="error" showIcon message={previewError} />}
            {stalePreview && previewUrl && (
              <p className={cardStyles.previewNotice}>内容已修改，点击“更新预览”查看最新效果。</p>
            )}
            <div
              className={cardStyles.previewPaper}
              data-loading={previewing}
              aria-busy={previewing}
            >
              {previewUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt={`${draft.displayName}商品名片预览`} />
                </>
              ) : !previewing ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="填写内容并选择图片后，点击更新预览"
                />
              ) : null}
              {previewing && (
                <div
                  className={cardStyles.previewLoading}
                  role="status"
                  aria-label="正在生成名片预览"
                >
                  <ImageSkeleton />
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
      <Modal
        title="更新商品数据"
        open={refreshing}
        onCancel={() => setRefreshing(false)}
        onOk={applyRefresh}
        okText="应用选中内容"
        cancelText="取消"
        okButtonProps={{ disabled: !refreshParts.length }}
      >
        <p className={cardStyles.help}>选择要刷新的内容，其他编辑会保留。报价明细将整份替换。</p>
        {(['name', 'materials', 'images', 'quote'] as const).map((part) => (
          <div key={part} className={cardStyles.refreshItem}>
            <Checkbox
              checked={refreshParts.includes(part)}
              onChange={(event) =>
                setRefreshParts((values) =>
                  event.target.checked
                    ? [...values, part]
                    : values.filter((value) => value !== part),
                )
              }
            >
              {partNames[part]}
            </Checkbox>
            <small>
              当前：
              {part === 'name'
                ? draft?.displayName
                : part === 'materials'
                  ? draft?.mainMaterials.join(' · ')
                  : part === 'images'
                    ? `${draft?.images.length ?? 0} 张已选图片`
                    : quote
                      ? `${quote.currency} ${quote.total}`
                      : '无完整报价'}
            </small>
            <span>更新为：{sourceSummary(freshSource, part)}</span>
          </div>
        ))}
      </Modal>
    </div>
  );
}
