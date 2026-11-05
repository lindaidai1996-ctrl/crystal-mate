'use client';

import { ArrowLeftOutlined, FileTextOutlined, SaveOutlined } from '@ant-design/icons';
import { App, Button, Form, Result, Skeleton, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { withAdminReturnTo } from '@/lib/admin-return-path';
import { emptyMaterial } from '@/lib/material-defaults';
import type { EditorDraftRecord } from '@/components/editorDraftBox';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  Material,
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
import { editMaterial, recalculateMaterial } from '@/lib/material-calculations';
import { BatchSelector } from './batchSelector';
import { DistributorSelect } from '@/components/distributorSelect/distributorSelect';
import { MaterialBasicFields } from './materialBasicFields';
import { MaterialDetailFields } from './materialDetailFields';
import {
  calculatePurchase,
  emptyPurchase,
  resolvePurchase,
  type MaterialPurchase,
} from '@/lib/material-purchase';

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

function readNewMaterialDraft(storageKey: string): NewMaterialDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as NewMaterialDraft | null;
  } catch {
    return null;
  }
}

export function MaterialEditor({
  id,
  entryId,
  initialBatchId,
  initialDistributorId,
  initialDraftId,
  initialReturnTo,
}: {
  id: string;
  entryId?: string;
  initialBatchId?: string;
  initialDistributorId?: string;
  initialDraftId?: string;
  initialReturnTo?: string;
}) {
  const t = useTranslations('materialEditor');
  const batchText = useTranslations('materialBatches');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const router = useRouter();
  const draftStorageKey =
    initialBatchId || initialDistributorId
      ? `${newMaterialDraftKey}:${JSON.stringify([initialBatchId, initialDistributorId])}`
      : newMaterialDraftKey;
  const [savedDraft] = useState(() =>
    id === 'new' && !initialDraftId ? readNewMaterialDraft(draftStorageKey) : null,
  );
  const [inputDraft, setDraft] = useState<MaterialValues>(() => ({
    ...emptyMaterial(),
    ...savedDraft?.values,
  }));
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>(savedDraft?.tagIds ?? []);
  const [images, setImages] = useState<ProductImage[]>(savedDraft?.images ?? []);
  const [batches, setBatches] = useState<MaterialBatch[]>([]);
  const [distributors, setDistributors] = useState<DistributorPage['items']>([]);
  const [selection, setSelection] = useState<MaterialBatchSelection | null>(
    savedDraft?.selection ?? (id === 'new' && initialBatchId ? { batchId: initialBatchId } : null),
  );
  const [distributorId, setDistributorId] = useState<string | undefined>(
    savedDraft?.distributorId ?? (id === 'new' ? initialDistributorId : undefined),
  );
  const [receivedQty, setReceivedQty] = useState<number | null>(savedDraft?.receivedQty ?? null);
  const [purchase, setPurchase] = useState<MaterialPurchase>(
    () => savedDraft?.purchase ?? emptyPurchase(),
  );
  const [quantityUnknown, setQuantityUnknown] = useState(savedDraft?.quantityUnknown ?? false);
  const effectiveQuantity =
    inputDraft.unit === 'GRAM'
      ? resolvePurchase(purchase).totalWeightGrams === null
        ? null
        : Number(resolvePurchase(purchase).totalWeightGrams)
      : quantityUnknown && purchase.mode === 'BATCH'
        ? null
        : receivedQty;
  const purchaseResult = calculatePurchase(inputDraft, purchase, effectiveQuantity);
  const draft = purchaseResult.values;
  const [linkedEntries, setLinkedEntries] = useState<MaterialBatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState(initialDraftId);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [createdMaterial, setCreatedMaterial] = useState<Material | null>(null);
  const isNew = id === 'new';
  const returnBatchId = isNew ? initialBatchId : undefined;
  const returnDistributorId = isNew ? initialDistributorId : undefined;
  const returnPath = returnBatchId
    ? `/admin/materials/batches/${encodeURIComponent(returnBatchId)}`
    : returnDistributorId
      ? `/admin/distributors/${encodeURIComponent(returnDistributorId)}`
      : (initialReturnTo ?? '/admin/materials');
  const returnLabel = returnBatchId
    ? common('backToBatch')
    : returnDistributorId
      ? common('backToDistributor')
      : t('back');
  const isMasterEdit = !isNew && !entryId;
  const isAddingEntry = entryId === 'new';

  useEffect(() => {
    if (!isNew || createdMaterial || activeDraftId) return;
    try {
      sessionStorage.setItem(
        draftStorageKey,
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
    draftStorageKey,
    isNew,
    createdMaterial,
    activeDraftId,
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
              field === 'name' ||
              field === 'aliases' ||
              field === 'categoryId' ||
              field === 'unit' ||
              field === 'notes'
                ? material[field as keyof MaterialValues]
                : (source as Partial<MaterialValues>)[field as keyof MaterialValues],
            ]),
          ) as MaterialValues;
          setDraft(values);
          if (material.unit === 'GRAM' && isAddingEntry)
            setPurchase({ ...emptyPurchase(), mode: 'BATCH' });
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

  useEffect(() => {
    if (!isNew || !initialDraftId) return;
    let active = true;
    apiFetch<EditorDraftRecord<NewMaterialDraft>>(`/api/editor-drafts/${initialDraftId}`)
      .then((saved) => {
        if (!active || saved.kind !== 'MATERIAL') throw new Error('INVALID_DRAFT');
        setDraft({ ...emptyMaterial(), ...saved.data.values });
        setTagIds(saved.data.tagIds ?? []);
        setImages(saved.data.images ?? []);
        setSelection(saved.data.selection ?? null);
        setDistributorId(saved.data.distributorId);
        setReceivedQty(saved.data.receivedQty ?? null);
        setPurchase(saved.data.purchase ?? emptyPurchase());
        setQuantityUnknown(saved.data.quantityUnknown ?? false);
      })
      .catch(() => {
        if (active) message.error(common('errors.NOT_FOUND'));
      });
    return () => {
      active = false;
    };
  }, [initialDraftId, isNew, message, common]);

  async function saveDraft() {
    if (saving || savingDraft || uploadingImages) return;
    setSavingDraft(true);
    try {
      const data: NewMaterialDraft = {
        values: inputDraft,
        tagIds,
        images,
        selection,
        distributorId,
        receivedQty,
        purchase,
        quantityUnknown,
      };
      const saved = await apiFetch<EditorDraftRecord<NewMaterialDraft>>(
        activeDraftId ? `/api/editor-drafts/${activeDraftId}` : '/api/editor-drafts',
        {
          method: activeDraftId ? 'PUT' : 'POST',
          body: JSON.stringify({ kind: 'MATERIAL', title: inputDraft.name.trim(), data }),
        },
      );
      setActiveDraftId(saved.id);
      try {
        sessionStorage.removeItem(draftStorageKey);
      } catch {
        // The database draft is saved even if browser storage is unavailable.
      }
      message.success(t('draftSaved'));
    } catch (error) {
      message.error(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSavingDraft(false);
    }
  }

  function change(field: keyof MaterialValues, value: string | number | null) {
    if (
      field === 'unit' &&
      value !== inputDraft.unit &&
      (value === 'GRAM' || inputDraft.unit === 'GRAM')
    ) {
      setPurchase({ ...emptyPurchase(), mode: value === 'GRAM' ? 'BATCH' : 'UNIT' });
      setReceivedQty(null);
      setQuantityUnknown(false);
      setDraft((current) =>
        recalculateMaterial({
          ...current,
          unit: value as MaterialValues['unit'],
          purchaseUnitPrice: null,
          weightGrams: null,
          purchaseGramPrice: null,
          purchaseGramManual: false,
          saleUnitPrice: null,
          saleGramPrice: null,
          saleUnitManual: false,
          saleGramManual: false,
        }),
      );
      return;
    }
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

  async function save() {
    if (saving || uploadingImages) return;
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
      (effectiveQuantity === null || effectiveQuantity < (draft.unit === 'GRAM' ? 0.01 : 1))
    ) {
      message.error(t('quantityRequired'));
      return;
    }
    if (!isMasterEdit && purchase.mode === 'BATCH' && !purchaseResult.valid) {
      message.error(t('batchValuesRequired'));
      return;
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
            aliases: values.aliases,
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
          sessionStorage.removeItem(draftStorageKey);
        } catch {
          // Storage can be unavailable even after the form was opened.
        }
        if (activeDraftId) {
          try {
            await apiFetch(`/api/editor-drafts/${activeDraftId}`, { method: 'DELETE' });
            setActiveDraftId(undefined);
          } catch {
            message.warning(t('draftCleanupFailed'));
          }
        }
        setCreatedMaterial(created);
        router.refresh();
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
      router.push(returnPath);
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
          router.push(
            withAdminReturnTo(`/admin/materials/${id}/batches/${existing.id}`, returnPath),
          );
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
      sessionStorage.removeItem(draftStorageKey);
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
    setActiveDraftId(undefined);
    window.scrollTo(0, 0);
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
            <Button
              onClick={() => {
                router.replace(returnPath);
                router.refresh();
              }}
            >
              {returnLabel}
            </Button>
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
          <Link href={returnPath} replace className="back-link">
            <ArrowLeftOutlined /> {returnLabel}
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
          <MaterialBasicFields
            values={draft}
            categories={categories}
            tags={tags}
            tagIds={tagIds}
            onTagsChange={setTagIds}
            onTagCreated={(tag) =>
              setTags((items) => [...items, tag].sort((a, b) => a.name.localeCompare(b.name)))
            }
            onCategoryCreated={(category) => {
              setCategories((items) =>
                [...items, category].sort((a, b) => a.name.localeCompare(b.name)),
              );
            }}
            onChange={change}
            onValuesChange={setDraft}
            onAliasesChange={(aliases) => setDraft((current) => ({ ...current, aliases }))}
            isAddingEntry={isAddingEntry}
            isMasterEdit={isMasterEdit}
            unitLocked={!isNew && linkedEntries.length > 0}
            submitted={submitted}
          />
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
                <DistributorSelect
                  value={distributorId}
                  aria-label={batchText('source')}
                  placeholder={batchText('source')}
                  distributors={distributors}
                  onChange={setDistributorId}
                />
                {!distributors.length && (
                  <Link href="/admin/distributors">{batchText('addSource')}</Link>
                )}
              </Form.Item>
            </section>
          )}
          <MaterialDetailFields
            values={draft}
            purchase={purchase}
            quantity={receivedQty}
            quantityUnknown={quantityUnknown}
            onQuantityChange={setReceivedQty}
            onUnknownChange={setQuantityUnknown}
            onPurchaseChange={setPurchase}
            onModeChange={changeMode}
            onChange={change}
            onRuleChange={changeRule}
            onValuesChange={setDraft}
            images={images}
            onImagesChange={setImages}
            onUploadingChange={setUploadingImages}
            disabled={saving}
            showDetails={!isMasterEdit}
            showNotes={!entryId}
          />
          <div className="editor-actions">
            <Link href={returnPath} replace>
              <Button>{common('cancel')}</Button>
            </Link>
            {isNew && (
              <Button
                icon={<FileTextOutlined />}
                onClick={() => void saveDraft()}
                loading={savingDraft}
                disabled={saving || uploadingImages}
              >
                {t('saveDraft')}
              </Button>
            )}
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={saving}
              disabled={uploadingImages}
            >
              {common('save')}
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}
