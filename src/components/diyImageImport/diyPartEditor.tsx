'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Tag,
} from 'antd';
import { DeleteOutlined, ScanOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import type { Material, Product } from '@/lib/client-types';
import {
  diySource,
  emptyDiyData,
  type DiyCandidate,
  type DiyPart,
} from '@/lib/diyImageImport/contracts';
import {
  MaterialSourceSummary,
  suggestedMaterialCost,
  useMaterialImagePreview,
} from '@/components/product-material-select';
import { suggestedMaterialQuote } from '@/lib/product-diy-quote';
import { diyQuoteLineTotal } from '@/lib/product-diy-cost';
import styles from './diyImport.module.css';

type Choices = { materials: Material[]; cabochons: Product[] };
export function DiyPartEditor({
  part,
  number,
  active,
  disabled,
  configured,
  onSelect,
  onPatch,
  onDelete,
  onRecognize,
  mergeTargets,
  onMerge,
}: {
  part: DiyPart;
  number: number;
  active: boolean;
  disabled: boolean;
  configured: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<DiyPart>) => void;
  onDelete: () => void;
  onRecognize: () => void;
  mergeTargets: { label: string; value: string }[];
  onMerge: (targetId: string) => void;
}) {
  const t = useTranslations('diyImport');
  const sources = useTranslations('productSources');
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<Choices>({ materials: [], cabochons: [] });
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [selectedCabochon, setSelectedCabochon] = useState<Product | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewCabochon, setPreviewCabochon] = useState(false);
  const request = useRef(0);
  const selectionRequest = useRef(0);
  const preview = useMaterialImagePreview();
  const selection = part.kind === 'MATERIAL' ? part.materialId : part.cabochonId;
  useEffect(() => {
    if (
      !selection ||
      (part.kind === 'MATERIAL'
        ? selectedMaterial?.id === selection
        : selectedCabochon?.id === selection)
    )
      return;
    let active = true;
    apiFetch<Choices>(`/api/diy-image-imports/candidates?kind=${part.kind}&id=${selection}`)
      .then((result) => {
        if (!active) return;
        if (result.materials[0]) setSelectedMaterial(result.materials[0]);
        if (result.cabochons[0]) setSelectedCabochon(result.cabochons[0]);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [part.kind, selection, selectedMaterial, selectedCabochon]);
  useEffect(() => {
    if (!active || disabled) return;
    const counter = request;
    const id = ++counter.current;
    const timer = setTimeout(() => {
      setLoading(true);
      apiFetch<Choices>(
        `/api/diy-image-imports/candidates?kind=${part.kind}&q=${encodeURIComponent(query)}`,
      )
        .then((result) => {
          if (id === request.current) {
            setChoices(result);
            setError(false);
          }
        })
        .catch(() => {
          if (id === request.current) setError(true);
        })
        .finally(() => {
          if (id === request.current) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      counter.current++;
    };
  }, [active, disabled, part.kind, query]);

  const material =
    selectedMaterial?.id === part.materialId
      ? selectedMaterial
      : choices.materials.find((item) => item.id === part.materialId);
  const cabochon =
    selectedCabochon?.id === part.cabochonId
      ? selectedCabochon
      : choices.cabochons.find((item) => item.id === part.cabochonId);
  const batch = material?.batchEntries.find((entry) => entry.id === part.materialBatchEntryId);
  const option =
    material && batch
      ? { material, entry: batch, label: `${material.name} · ${batch.batch.name}` }
      : null;
  const unitOptions =
    material?.unit === 'STRAND' ? ['BEAD', 'STRAND', 'GRAM'] : [material?.unit ?? 'BEAD'];
  const materialChoices =
    material && !choices.materials.some((item) => item.id === material.id)
      ? [material, ...choices.materials]
      : choices.materials;
  const cabochonChoices =
    cabochon && !choices.cabochons.some((item) => item.id === cabochon.id)
      ? [cabochon, ...choices.cabochons]
      : choices.cabochons;

  async function chooseCandidate(candidate: DiyCandidate) {
    const choiceRequest = ++selectionRequest.current;
    setLoading(true);
    setError(false);
    try {
      const result = await apiFetch<Choices>(
        `/api/diy-image-imports/candidates?kind=${candidate.kind}&id=${candidate.id}`,
      );
      if (choiceRequest !== selectionRequest.current) return;
      if (candidate.kind === 'MATERIAL') {
        const item = result.materials[0];
        if (!item) throw new Error('NOT_FOUND');
        setSelectedMaterial(item);
        onPatch({
          kind: 'MATERIAL',
          materialId: item.id,
          materialBatchEntryId: null,
          cabochonId: null,
          usageUnit: item.unit === 'STRAND' ? 'BEAD' : item.unit,
          ...(item.unit === 'GRAM' ? { quantity: '' } : {}),
          unitCost: '',
          quoteUnitPrice: null,
        });
      } else {
        const item = result.cabochons[0];
        if (!item) throw new Error('NOT_FOUND');
        setSelectedCabochon(item);
        onPatch({
          kind: 'CABOCHON',
          cabochonId: item.id,
          materialId: null,
          materialBatchEntryId: null,
          usageUnit: 'BEAD',
          unitCost: item.cost?.totalCost ?? '',
          quoteUnitPrice: (item.priceCents / 100).toFixed(2),
        });
      }
    } catch {
      if (choiceRequest === selectionRequest.current) setError(true);
    } finally {
      if (choiceRequest === selectionRequest.current) setLoading(false);
    }
  }
  const canReview = !!diySource({
    ...emptyDiyData(),
    parts: [{ ...part, excluded: false, reviewed: true }],
  });
  return (
    <article className={`${styles.part} ${active ? styles.activePart : ''}`}>
      <div className={styles.partHeading}>
        <button className={styles.partTitle} type="button" onClick={onSelect}>
          {number}. {part.name || t('unnamedPart')}
        </button>
        <Tag color={part.excluded ? 'default' : part.reviewed ? 'success' : 'warning'}>
          {t(part.excluded ? 'excluded' : part.reviewed ? 'reviewed' : 'pending')}
        </Tag>
      </div>
      {error && (
        <Alert type="error" showIcon message={t('candidateError')} className={styles.notice} />
      )}
      {!part.excluded && (
        <>
          <div className={styles.partFields}>
            <label className={`${styles.field} ${styles.wide}`}>
              <span>{t('partName')}</span>
              <Input
                maxLength={120}
                value={part.name}
                disabled={disabled}
                onFocus={onSelect}
                onChange={(event) => onPatch({ name: event.target.value })}
              />
            </label>
            <p className={`${styles.muted} ${styles.wide}`}>{part.description}</p>
          </div>
          {!!part.warnings.length && (
            <ul className={styles.warnings}>
              {part.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          {!!part.candidates.length && (
            <div className={styles.candidates}>
              <span className={styles.muted}>{t('candidates')}</span>
              {part.candidates.map((candidate) => (
                <div className={styles.candidate} key={`${candidate.kind}:${candidate.id}`}>
                  <Button
                    size="small"
                    disabled={disabled || loading}
                    onClick={() => void chooseCandidate(candidate)}
                  >
                    {candidate.name}
                  </Button>
                  <p>{candidate.reason}</p>
                </div>
              ))}
            </div>
          )}
          <div className={styles.partFields}>
            <label className={styles.field}>
              <span>{t('partKind')}</span>
              <Select
                value={part.kind}
                disabled={disabled}
                options={[
                  { value: 'MATERIAL', label: t('material') },
                  { value: 'CABOCHON', label: t('cabochon') },
                ]}
                onChange={(kind) =>
                  onPatch({
                    kind,
                    materialId: null,
                    materialBatchEntryId: null,
                    cabochonId: null,
                    unitCost: '',
                    quoteUnitPrice: null,
                    usageUnit: 'BEAD',
                  })
                }
              />
            </label>
            <label className={styles.field}>
              <span>{t(part.kind === 'MATERIAL' ? 'material' : 'cabochon')}</span>
              <Select
                showSearch
                filterOption={false}
                loading={loading}
                value={selection ?? undefined}
                disabled={disabled}
                onFocus={onSelect}
                onSearch={setQuery}
                placeholder={t('searchMaterial')}
                options={
                  part.kind === 'MATERIAL'
                    ? materialChoices.map((item) => ({ value: item.id, label: item.name }))
                    : cabochonChoices.map((item) => ({
                        value: item.id,
                        label: `${item.name} · ${item.code}`,
                      }))
                }
                onChange={(id) =>
                  void chooseCandidate({ id, kind: part.kind, name: '', reason: '' })
                }
              />
            </label>
            {part.kind === 'MATERIAL' && (
              <label className={`${styles.field} ${styles.wide}`}>
                <span>{t('batch')}</span>
                <Select
                  disabled={disabled || !material}
                  value={part.materialBatchEntryId ?? undefined}
                  placeholder={t('chooseBatch')}
                  options={material?.batchEntries.map((entry) => ({
                    value: entry.id,
                    label: `${entry.batch.name} · ${entry.distributor.name} · ${t('remaining')}: ${entry.remainingQty ?? '—'} ${sources(material.unit)}`,
                  }))}
                  onChange={(id) => {
                    const entry = material!.batchEntries.find((item) => item.id === id)!;
                    const selected = {
                      material: material!,
                      entry,
                      label: `${material!.name} · ${entry.batch.name}`,
                    };
                    onPatch({
                      materialBatchEntryId: id,
                      unitCost: suggestedMaterialCost(selected, part.usageUnit) ?? '',
                      quoteUnitPrice: suggestedMaterialQuote(selected, part.usageUnit),
                    });
                  }}
                />
              </label>
            )}
            {option && (
              <div className={styles.wide}>
                <MaterialSourceSummary option={option} preview={preview} />
              </div>
            )}
            {part.kind === 'CABOCHON' && cabochon && (
              <div className={styles.wide}>
                <Button size="small" onClick={() => setPreviewCabochon(!previewCabochon)}>
                  {t('previewImages')}
                </Button>
                {previewCabochon && (
                  <Image.PreviewGroup>
                    {cabochon.images.map((image) => (
                      <Image key={image.objectKey} width={80} src={image.url} alt={cabochon.name} />
                    ))}
                  </Image.PreviewGroup>
                )}
              </div>
            )}
            <label className={styles.field}>
              <span>{t('usageUnit')}</span>
              <Select
                disabled={disabled || part.kind === 'CABOCHON'}
                value={part.usageUnit}
                options={unitOptions.map((value) => ({ value, label: sources(value) }))}
                onChange={(unit: DiyPart['usageUnit']) =>
                  onPatch({
                    usageUnit: unit,
                    quantity: unit === 'GRAM' ? '' : part.quantity,
                    unitCost: option ? (suggestedMaterialCost(option, unit) ?? '') : '',
                    quoteUnitPrice: option ? suggestedMaterialQuote(option, unit) : null,
                  })
                }
              />
            </label>
            <label className={styles.field}>
              <span>{t('quantityPerItem')}</span>
              <InputNumber<string>
                stringMode
                min="0.01"
                max="9999999999.99"
                precision={part.usageUnit === 'GRAM' ? 2 : 0}
                value={part.quantity || null}
                disabled={disabled}
                onChange={(value) => onPatch({ quantity: value ?? '' })}
              />
            </label>
            <label className={styles.field}>
              <span>{t('unitCost')}</span>
              <InputNumber<string>
                stringMode
                min="0"
                max="9999999999.99"
                precision={2}
                value={part.unitCost || null}
                disabled={disabled}
                onChange={(value) => onPatch({ unitCost: value ?? '' })}
              />
            </label>
            <div className={styles.field}>
              <span>{t('lineCost')}</span>
              <strong>{diyQuoteLineTotal(part.quantity, part.unitCost) ?? '—'}</strong>
            </div>
          </div>
        </>
      )}
      <div className={styles.partActions}>
        <Space wrap>
          <Checkbox
            checked={part.excluded}
            disabled={disabled}
            onChange={(event) => onPatch({ excluded: event.target.checked, reviewed: false })}
          >
            {t('exclude')}
          </Checkbox>
          {!part.excluded && (
            <Checkbox
              checked={part.reviewed}
              disabled={disabled || !canReview}
              onChange={(event) => onPatch({ reviewed: event.target.checked })}
            >
              {t('confirmPart')}
            </Checkbox>
          )}
        </Space>
        <Space wrap>
          <Button
            size="small"
            icon={<ScanOutlined />}
            disabled={
              disabled || !configured || part.reviewed || part.excluded || !part.views.length
            }
            onClick={onRecognize}
          >
            {t('recognizePart')}
          </Button>
          <Popconfirm title={t('deletePartConfirm')} onConfirm={onDelete} disabled={disabled}>
            <Button
              size="small"
              icon={<DeleteOutlined />}
              disabled={disabled}
              aria-label={t('deletePart')}
            />
          </Popconfirm>
        </Space>
      </div>
      {preview.viewer}
      {!part.excluded && mergeTargets.length > 0 && (
        <Select
          className={styles.wide}
          style={{ width: '100%', marginTop: 10 }}
          value={undefined}
          placeholder={t('mergeInto')}
          disabled={disabled}
          options={mergeTargets}
          onChange={onMerge}
        />
      )}
    </article>
  );
}
