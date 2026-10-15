'use client';

import { ArrowLeftOutlined, PlusOutlined, ScanOutlined, SaveOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Cascader,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Result,
  Select,
  Skeleton,
  Space,
  Tooltip,
} from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  Material,
  MaterialAmount,
  MaterialBatch,
  MaterialBatchEntry,
  MaterialBatchSelection,
  MaterialCategory,
  MaterialSaleRule,
  MaterialValues,
  DistributorPage,
  ProductImage,
  Tag,
} from '@/lib/client-types';
import {
  editMaterial,
  purchaseCandidates,
  recalculateMaterial,
  recognizeMaterialCategory,
} from '@/lib/material-calculations';
import { ImagePicker } from '@/components/image-picker';
import { categoryPath, categoryTree } from './categoryTree';
import { BatchSelector } from './batchSelector';
import { MaterialAmountInput as AmountInput, PurchaseFields } from './purchaseFields';
import { calculatePurchase, emptyPurchase, type MaterialPurchase } from '@/lib/material-purchase';

function emptyMaterial(): MaterialValues {
  return {
    name: '',
    categoryId: '',
    unit: 'STRAND',
    purchaseUnitPrice: null,
    weightGrams: null,
    purchaseGramPrice: null,
    purchaseGramManual: false,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    childCount: null,
    childWeightGrams: null,
    childUnitPrice: null,
    childPriceSource: null,
    saleRule: 'COST',
    saleRuleValue: null,
    saleUnitPrice: null,
    saleGramPrice: null,
    saleChildUnitPrice: null,
    saleUnitManual: false,
    saleGramManual: false,
    saleChildManual: false,
    notes: '',
  };
}

const newMaterialDraftKey = 'crystal-mate:new-material-draft';

type NewMaterialDraft = {
  values: MaterialValues;
  tagIds?: string[];
  images: ProductImage[];
  selection: MaterialBatchSelection | null;
  distributorId?: string;
  receivedQty: number | null;
  purchase?: MaterialPurchase;
  quantityUnknown?: boolean;
};

function readNewMaterialDraft(): NewMaterialDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(
      sessionStorage.getItem(newMaterialDraftKey) ?? 'null',
    ) as NewMaterialDraft | null;
  } catch {
    return null;
  }
}

export function MaterialEditor({ id, entryId }: { id: string; entryId?: string }) {
  const t = useTranslations('materialEditor');
  const tagText = useTranslations('tags');
  const batchText = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [tagForm] = Form.useForm<{ name: string }>();
  const [savedDraft] = useState(() => (id === 'new' ? readNewMaterialDraft() : null));
  const [inputDraft, setDraft] = useState<MaterialValues>(
    () => savedDraft?.values ?? emptyMaterial(),
  );
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>(savedDraft?.tagIds ?? []);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [images, setImages] = useState<ProductImage[]>(savedDraft?.images ?? []);
  const [batches, setBatches] = useState<MaterialBatch[]>([]);
  const [distributors, setDistributors] = useState<DistributorPage['items']>([]);
  const [selection, setSelection] = useState<MaterialBatchSelection | null>(
    savedDraft?.selection ?? null,
  );
  const [distributorId, setDistributorId] = useState<string | undefined>(savedDraft?.distributorId);
  const [receivedQty, setReceivedQty] = useState<number | null>(savedDraft?.receivedQty ?? null);
  const [purchase, setPurchase] = useState<MaterialPurchase>(
    () => savedDraft?.purchase ?? emptyPurchase(),
  );
  const [quantityUnknown, setQuantityUnknown] = useState(savedDraft?.quantityUnknown ?? false);
  const effectiveQuantity = quantityUnknown && purchase.mode === 'BATCH' ? null : receivedQty;
  const purchaseResult = calculatePurchase(inputDraft, purchase, effectiveQuantity);
  const draft = purchaseResult.values;
  const [originalUnit, setOriginalUnit] = useState<MaterialValues['unit']>();
  const [hasChildDetails, setHasChildDetails] = useState(false);
  const [linkedEntries, setLinkedEntries] = useState<MaterialBatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createdMaterial, setCreatedMaterial] = useState<Material | null>(null);
  const isNew = id === 'new';
  const isMasterEdit = !isNew && !entryId;
  const isAddingEntry = entryId === 'new';
  const candidates = purchaseCandidates(draft);

  useEffect(() => {
    if (!isNew || createdMaterial) return;
    try {
      sessionStorage.setItem(
        newMaterialDraftKey,
        JSON.stringify({
          values: inputDraft,
          tagIds,
          images,
          selection,
          distributorId,
          receivedQty,
          purchase,
          quantityUnknown,
        }),
      );
    } catch {
      // Private browsing or disabled storage should not block editing.
    }
  }, [
    isNew,
    createdMaterial,
    inputDraft,
    tagIds,
    images,
    selection,
    distributorId,
    receivedQty,
    purchase,
    quantityUnknown,
  ]);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<MaterialCategory[]>('/api/material-categories'),
      apiFetch<Tag[]>('/api/tags'),
      isNew ? Promise.resolve(null) : apiFetch<Material>(`/api/materials/${id}`),
      apiFetch<MaterialBatch[]>('/api/material-batches'),
      apiFetch<DistributorPage>('/api/distributors'),
    ])
      .then(([categoryList, tagList, material, batchList, distributorPage]) => {
        if (!active) return;
        setCategories(categoryList);
        setTags(tagList);
        setBatches(batchList);
        setDistributors(distributorPage.items);
        if (material) {
          setTagIds(material.tags.map((tag) => tag.id));
          setOriginalUnit(material.unit);
          setHasChildDetails(
            [material, ...material.batchEntries].some(
              (item) =>
                item.childCount !== null ||
                item.childWeightGrams !== null ||
                item.childUnitPrice !== null ||
                item.childPriceSource !== null ||
                item.saleChildUnitPrice !== null ||
                item.saleChildManual,
            ),
          );
          setLinkedEntries(material.batchEntries);
          const entry =
            entryId && !isAddingEntry
              ? material.batchEntries.find((item) => item.id === entryId)
              : isAddingEntry
                ? material.batchEntries[0]
                : null;
          if (entryId && !isAddingEntry && !entry) throw new Error('NOT_FOUND');
          const source = entry ?? material;
          const values = Object.fromEntries(
            Object.keys(emptyMaterial()).map((field) => [
              field,
              field === 'name' || field === 'categoryId' || field === 'unit' || field === 'notes'
                ? material[field as keyof MaterialValues]
                : (source as Partial<MaterialValues>)[field as keyof MaterialValues],
            ]),
          ) as MaterialValues;
          setDraft(values);
          setImages(source.images);
          if (entry && !isAddingEntry) {
            setSelection({ batchId: entry.batchId });
            setDistributorId(entry.distributorId);
            setReceivedQty(entry.receivedQty);
            setPurchase(entry.purchase ?? emptyPurchase());
            setQuantityUnknown(entry.receivedQty === null && entry.purchase?.mode === 'BATCH');
          }
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, entryId, isNew, isAddingEntry, revision]);

  function change(field: keyof MaterialValues, value: string | number | null) {
    setDraft((current) =>
      editMaterial(calculatePurchase(current, purchase, effectiveQuantity).values, field, value),
    );
  }

  function changeMode(mode: MaterialPurchase['mode']) {
    if (mode === purchase.mode) return;
    if (mode === 'BATCH') {
      setPurchase({
        ...purchase,
        mode,
        unitInputs: {
          price: draft.purchaseUnitPrice,
          weight: draft.weightGrams,
          gramPrice: draft.purchaseGramPrice,
          gramManual: draft.purchaseGramManual,
        },
      });
    } else {
      const saved = purchase.unitInputs;
      setDraft({
        ...draft,
        purchaseUnitPrice: saved?.price ?? null,
        weightGrams: saved?.weight ?? null,
        purchaseGramPrice: saved?.gramPrice ?? null,
        purchaseGramManual: saved?.gramManual ?? false,
      });
      setPurchase({ ...purchase, mode });
    }
  }

  function changeRule(rule: MaterialSaleRule) {
    setDraft((current) =>
      recalculateMaterial(
        {
          ...calculatePurchase(current, purchase, effectiveQuantity).values,
          saleRule: rule,
          saleRuleValue:
            rule === 'FIXED_AMOUNT' || rule === 'CUSTOM_PERCENT'
              ? (current.saleRuleValue ?? '0.00')
              : null,
        },
        true,
      ),
    );
  }

  function recognize() {
    const category = recognizeMaterialCategory(draft.name, categories);
    if (!category) {
      message.warning(t('recognitionFailed'));
      return;
    }
    setDraft((current) => ({ ...current, categoryId: category.id }));
    message.success(t('recognized', { category: category.name }));
  }

  async function createTag({ name }: { name: string }) {
    setCreatingTag(true);
    try {
      const tag = await apiFetch<Tag>('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setTags((items) => [...items, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setTagIds((current) => [...current, tag.id]);
      message.success(common('saved'));
      tagForm.resetFields();
      setTagModalOpen(false);
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setCreatingTag(false);
    }
  }

  async function save() {
    setSubmitted(true);
    if (!draft.name.trim() || !draft.categoryId) {
      message.error(t('required'));
      return;
    }
    if (!isMasterEdit && (!entryId || isAddingEntry) && !selection) {
      message.error(t('batchRequired'));
      return;
    }
    if (
      !isMasterEdit &&
      (!entryId || isAddingEntry) &&
      selection?.newBatch &&
      (!selection.newBatch.name.trim() || !selection.newBatch.receivedAt)
    ) {
      message.error(batchText('required'));
      return;
    }
    if (!isMasterEdit && !distributorId) {
      message.error(t('sourceRequired'));
      return;
    }
    if (
      !isMasterEdit &&
      !(purchase.mode === 'BATCH' && quantityUnknown) &&
      (!receivedQty || receivedQty < 1)
    ) {
      message.error(t('quantityRequired'));
      return;
    }
    if (!isMasterEdit && purchase.mode === 'BATCH' && !purchaseResult.valid) {
      message.error(t('batchValuesRequired'));
      return;
    }
    if (originalUnit === 'STRAND' && draft.unit === 'BEAD' && hasChildDetails && !isAddingEntry) {
      const confirmed = await modal.confirm({
        title: t('unitChangeTitle'),
        content: t('unitChangeWarning'),
        okText: common('save'),
        cancelText: common('cancel'),
      });
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const values = {
        ...draft,
        name: draft.name.trim(),
        notes: draft.notes.trim(),
        imageKeys: images.map((image) => image.objectKey),
      };
      if (isMasterEdit) {
        await apiFetch(`/api/materials/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: values.name,
            categoryId: values.categoryId,
            tagIds,
            unit: values.unit,
            notes: values.notes,
          }),
        });
      } else if (isNew) {
        const created = await apiFetch<Material>('/api/materials', {
          method: 'POST',
          body: JSON.stringify({
            values,
            tagIds,
            selection,
            distributorId,
            receivedQty: effectiveQuantity,
            purchase: purchaseResult.purchase,
          }),
        });
        const batch = created.batchEntries[0].batch;
        setBatches((current) =>
          current.some((item) => item.id === batch.id) ? current : [batch, ...current],
        );
        try {
          sessionStorage.removeItem(newMaterialDraftKey);
        } catch {
          // Storage can be unavailable even after the form was opened.
        }
        setCreatedMaterial(created);
        window.scrollTo(0, 0);
        return;
      } else if (isAddingEntry) {
        await apiFetch(`/api/materials/${id}/batches`, {
          method: 'POST',
          body: JSON.stringify({
            values,
            selection,
            distributorId,
            receivedQty: effectiveQuantity,
            purchase: purchaseResult.purchase,
          }),
        });
      } else {
        await apiFetch(`/api/materials/${id}/batches/${entryId}`, {
          method: 'PUT',
          body: JSON.stringify({
            values,
            tagIds,
            distributorId,
            receivedQty: effectiveQuantity,
            purchase: purchaseResult.purchase,
          }),
        });
      }
      message.success(common('saved'));
      router.push('/admin/materials');
      router.refresh();
    } catch (error) {
      if (
        error instanceof ClientApiError &&
        error.code === 'MATERIAL_ALREADY_IN_BATCH' &&
        isAddingEntry &&
        selection?.batchId
      ) {
        const existing = linkedEntries.find((item) => item.batchId === selection.batchId);
        if (existing) {
          message.warning(common('errors.MATERIAL_ALREADY_IN_BATCH'));
          router.push(`/admin/materials/${id}/batches/${existing.id}`);
          return;
        }
      }
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  function addAnother(reuseBatchAndDistributor: boolean) {
    const entry = createdMaterial?.batchEntries[0];
    try {
      sessionStorage.removeItem(newMaterialDraftKey);
    } catch {
      // The form remains usable without storage.
    }
    setDraft(emptyMaterial());
    setTagIds([]);
    setImages([]);
    setReceivedQty(null);
    setPurchase(emptyPurchase());
    setQuantityUnknown(false);
    setSubmitted(false);
    setSelection(reuseBatchAndDistributor && entry ? { batchId: entry.batchId } : null);
    setDistributorId(reuseBatchAndDistributor ? entry?.distributorId : undefined);
    setCreatedMaterial(null);
    window.scrollTo(0, 0);
  }

  function amount(field: keyof MaterialValues, suffix: string, positive = false) {
    return (
      <AmountInput
        value={draft[field] as MaterialAmount}
        onChange={(value) => change(field, value)}
        suffix={suffix}
        label={t(field as never)}
        positive={positive}
      />
    );
  }

  if (loading) return <Skeleton active paragraph={{ rows: 12 }} />;
  if (loadError)
    return (
      <Result
        status="error"
        title={t('loadFailed')}
        extra={
          <Button
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              setRevision((value) => value + 1);
            }}
          >
            {common('retry')}
          </Button>
        }
      />
    );

  if (createdMaterial)
    return (
      <Result
        status="success"
        title={common('saved')}
        extra={
          <Space wrap>
            <Button onClick={() => router.push('/admin/materials')}>{t('back')}</Button>
            <Button onClick={() => addAnother(false)}>{t('addAnother')}</Button>
            <Button type="primary" onClick={() => addAnother(true)}>
              {t('addAnotherWithBatchAndDistributor')}
            </Button>
          </Space>
        }
      />
    );

  return (
    <>
      <div className="page-heading editor-heading">
        <div>
          <Link href="/admin/materials" className="back-link">
            <ArrowLeftOutlined /> {t('back')}
          </Link>
          <h1>
            {isNew
              ? t('newTitle')
              : isMasterEdit
                ? t('editTitle')
                : isAddingEntry
                  ? batchText('add')
                  : batchText('edit')}
          </h1>
        </div>
      </div>
      <Form layout="vertical" onFinish={save}>
        <div className="editor-surface material-editor">
          <section className="editor-block">
            <h2>{t('basics')}</h2>
            <div className="material-field-grid">
              <Form.Item
                label={t('name')}
                required
                validateStatus={submitted && !draft.name.trim() ? 'error' : undefined}
                help={submitted && !draft.name.trim() ? t('required') : undefined}
              >
                <Input
                  value={draft.name}
                  aria-label={t('name')}
                  disabled={isAddingEntry}
                  maxLength={120}
                  onChange={(event) => change('name', event.target.value)}
                />
              </Form.Item>
              <Form.Item
                label={t('category')}
                required
                validateStatus={submitted && !draft.categoryId ? 'error' : undefined}
                help={submitted && !draft.categoryId ? t('required') : undefined}
              >
                <div className="material-category-control">
                  <Cascader
                    options={categoryTree(categories)}
                    disabled={isAddingEntry}
                    value={draft.categoryId ? categoryPath(draft.categoryId, categories) : []}
                    onChange={(path) => change('categoryId', (path?.at(-1) as string) ?? '')}
                    placeholder={t('selectCategory')}
                    aria-label={t('category')}
                    showSearch
                    changeOnSelect
                    allowClear
                  />
                  {!isAddingEntry && (
                    <Tooltip title={t('recognize')}>
                      <Button
                        icon={<ScanOutlined />}
                        onClick={recognize}
                        aria-label={t('recognize')}
                      >
                        {t('recognize')}
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </Form.Item>
              {!categories.length && (
                <Link href="/admin/materials/categories">{t('noCategories')}</Link>
              )}
              <div className="editor-field-tags material-full-width">
                <Form.Item label={t('tags')}>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    value={tagIds}
                    onChange={setTagIds}
                    disabled={isAddingEntry}
                    aria-label={t('tags')}
                    placeholder={t('selectTags')}
                    options={tags.map((item) => ({ value: item.id, label: item.name }))}
                  />
                </Form.Item>
                {!isAddingEntry && (
                  <Tooltip title={tagText('new')}>
                    <Button
                      icon={<PlusOutlined />}
                      aria-label={tagText('new')}
                      onClick={() => {
                        tagForm.resetFields();
                        setTagModalOpen(true);
                      }}
                    />
                  </Tooltip>
                )}
              </div>
              <Form.Item label={t('unit')} className="material-full-width">
                <Radio.Group
                  value={draft.unit}
                  aria-label={t('unit')}
                  disabled={isAddingEntry}
                  onChange={(event) => change('unit', event.target.value)}
                  options={[
                    { label: t('STRAND'), value: 'STRAND' },
                    { label: t('BEAD'), value: 'BEAD' },
                  ]}
                />
              </Form.Item>
            </div>
            {!isMasterEdit && (
              <>
                <h3 className="material-subheading">{t('dimensions')}</h3>
                <div className="material-field-grid material-three-columns">
                  <Form.Item label={t('lengthMm')}>{amount('lengthMm', 'mm', true)}</Form.Item>
                  <Form.Item label={t('widthMm')}>{amount('widthMm', 'mm', true)}</Form.Item>
                  <Form.Item label={t('heightMm')}>{amount('heightMm', 'mm', true)}</Form.Item>
                </div>
              </>
            )}
          </section>
          {!isMasterEdit && (!entryId || isAddingEntry) && (
            <BatchSelector selection={selection} onChange={setSelection} batches={batches} />
          )}
          {!isMasterEdit && entryId && !isAddingEntry && (
            <section className="editor-block">
              <h2>{batchText('batch')}</h2>
              <p>{batches.find((batch) => batch.id === selection?.batchId)?.name}</p>
            </section>
          )}
          {!isMasterEdit && (
            <section className="editor-block">
              <h2>{batchText('source')}</h2>
              <Form.Item label={batchText('source')} required>
                <Select
                  showSearch
                  optionFilterProp="label"
                  value={distributorId}
                  aria-label={batchText('source')}
                  placeholder={batchText('source')}
                  options={distributors.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${item.area}`,
                  }))}
                  onChange={setDistributorId}
                />
                {!distributors.length && (
                  <Link href="/admin/distributors">{batchText('addSource')}</Link>
                )}
              </Form.Item>
            </section>
          )}
          {!isMasterEdit && (
            <PurchaseFields
              values={draft}
              purchase={purchase}
              quantity={receivedQty}
              quantityUnknown={quantityUnknown}
              onQuantityChange={setReceivedQty}
              onUnknownChange={setQuantityUnknown}
              onPurchaseChange={setPurchase}
              onModeChange={changeMode}
              onValueChange={change}
            />
          )}
          {!isMasterEdit && (
            <section className="editor-block">
              <h2>{t('images')}</h2>
              <ImagePicker images={images} onChange={setImages} />
            </section>
          )}
          {!isMasterEdit && draft.unit === 'STRAND' && (
            <section className="editor-block">
              <h2>{t('purchaseDetails')}</h2>
              <div className="material-field-grid material-three-columns">
                <Form.Item label={t('childCount')}>
                  <InputNumber<number>
                    value={draft.childCount}
                    aria-label={t('childCount')}
                    onChange={(value) => change('childCount', value)}
                    min={1}
                    max={2147483647}
                    precision={0}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item label={t('childWeightGrams')}>
                  {amount('childWeightGrams', 'g', true)}
                </Form.Item>
                <Form.Item label={t('childUnitPrice')}>
                  {amount('childUnitPrice', t('yuanPerBead'))}
                  {draft.childPriceSource && draft.childPriceSource !== 'CUSTOM' && (
                    <div className="material-source-label">
                      {t(`source_${draft.childPriceSource}`)}
                    </div>
                  )}
                  <div className="material-price-suggestions">
                    <div>
                      <span>
                        {t('byCount')}: {candidates.count ?? '—'}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        disabled={candidates.count === null}
                        onClick={() =>
                          setDraft((current) =>
                            recalculateMaterial({
                              ...current,
                              childUnitPrice: candidates.count,
                              childPriceSource: 'COUNT',
                            }),
                          )
                        }
                      >
                        {t('adopt')}
                      </Button>
                    </div>
                    <div>
                      <span>
                        {t('byWeight')}: {candidates.weight ?? '—'}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        disabled={candidates.weight === null}
                        onClick={() =>
                          setDraft((current) =>
                            recalculateMaterial({
                              ...current,
                              childUnitPrice: candidates.weight,
                              childPriceSource: 'WEIGHT',
                            }),
                          )
                        }
                      >
                        {t('adopt')}
                      </Button>
                    </div>
                  </div>
                </Form.Item>
              </div>
            </section>
          )}
          {!isMasterEdit && (
            <section className="editor-block">
              <h2>{t('saleDetails')}</h2>
              <Form.Item label={t('saleRule')}>
                <Radio.Group
                  className="material-rule-options"
                  value={draft.saleRule}
                  aria-label={t('saleRule')}
                  onChange={(event) => changeRule(event.target.value)}
                  options={(
                    [
                      'COST',
                      'PERCENT_10',
                      'PERCENT_20',
                      'PERCENT_30',
                      'PERCENT_50',
                      'FIXED_AMOUNT',
                      'CUSTOM_PERCENT',
                    ] as const
                  ).map((rule) => ({ label: t(`rule_${rule}`), value: rule }))}
                />
              </Form.Item>
              {(draft.saleRule === 'FIXED_AMOUNT' || draft.saleRule === 'CUSTOM_PERCENT') && (
                <Form.Item
                  label={t(draft.saleRule === 'FIXED_AMOUNT' ? 'fixedAmount' : 'customPercent')}
                >
                  {amount('saleRuleValue', draft.saleRule === 'FIXED_AMOUNT' ? t('yuan') : '%')}
                </Form.Item>
              )}
              <div className="material-field-grid material-three-columns">
                <Form.Item label={t('saleUnitPrice')}>
                  {amount('saleUnitPrice', t('yuan'))}
                </Form.Item>
                <Form.Item label={t('saleGramPrice')}>
                  {amount('saleGramPrice', t('yuanPerGram'))}
                </Form.Item>
                {draft.unit === 'STRAND' && (
                  <Form.Item label={t('saleChildUnitPrice')}>
                    {amount('saleChildUnitPrice', t('yuanPerBead'))}
                  </Form.Item>
                )}
              </div>
            </section>
          )}
          {!entryId && (
            <section className="editor-block">
              <h2>{t('notes')}</h2>
              <Input.TextArea
                value={draft.notes}
                aria-label={t('notes')}
                onChange={(event) => change('notes', event.target.value)}
                maxLength={10000}
                rows={4}
                showCount
              />
            </section>
          )}
          <div className="editor-actions">
            <Link href="/admin/materials">
              <Button>{common('cancel')}</Button>
            </Link>
            <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
              {common('save')}
            </Button>
          </div>
        </div>
      </Form>
      <Modal
        title={tagText('newTitle')}
        open={tagModalOpen}
        onCancel={() => {
          if (!creatingTag) {
            tagForm.resetFields();
            setTagModalOpen(false);
          }
        }}
        onOk={() => tagForm.submit()}
        okText={common('save')}
        cancelText={common('cancel')}
        confirmLoading={creatingTag}
        forceRender
      >
        <Form form={tagForm} layout="vertical" onFinish={createTag}>
          <Form.Item
            name="name"
            label={tagText('name')}
            rules={[{ required: true, whitespace: true, max: 60 }]}
          >
            <Input maxLength={60} autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
