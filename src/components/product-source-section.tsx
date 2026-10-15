'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import type {
  Category,
  DistributorPage,
  Material,
  MaterialBatch,
  MaterialPage,
  Product,
  ProductPage,
  ProductSourceInput,
} from '@/lib/client-types';
import { CLIENT_TABLE_PAGINATION } from '@/lib/table-pagination';
import { productSourceSchema } from '@/lib/validation';
import { suggestedMaterialQuote } from '@/lib/product-diy-quote';
import {
  calculateDiyCost,
  calculateDiyQuote,
  diyQuoteLineTotal,
  craftDesignFeeTotal,
  emptyCraftDesignFee,
} from '@/lib/product-diy-cost';
import { todayInChina } from './materialManagement/batchSelector';
import {
  MaterialSourceSelect,
  MaterialSourceSummary,
  suggestedMaterialCost,
  useMaterialImagePreview,
  type MaterialOption,
} from './product-material-select';
type CabochonOption = { product: Product; label: string };
type EditorMode = 'add' | 'edit' | 'correct';

export function initialSource(
  origin: ProductSourceInput['origin'] = 'PURCHASED',
): ProductSourceInput {
  return origin === 'PURCHASED'
    ? {
        origin,
        selection: { batchId: '' },
        distributorId: '',
        quantity: 1,
        unitCost: '',
        notes: '',
      }
    : {
        origin,
        quantity: 1,
        notes: '',
        materials: [],
        cabochons: [],
        extraCosts: [],
        craftDesignFee: { ...emptyCraftDesignFee(), unitAmount: '100' },
      };
}

function money(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function QuotePriceField({
  value,
  onChange,
  label,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  label?: string;
}) {
  const t = useTranslations('productSources');
  return (
    <label className="source-field">
      <span>{label ?? t('quoteUnitPrice')}</span>
      <InputNumber<string>
        stringMode
        min="0"
        max="9999999999.99"
        precision={2}
        value={value ?? null}
        placeholder={t('quoteMissing')}
        onChange={onChange}
      />
    </label>
  );
}

function LineTotals({
  quantity,
  unitCost,
  quoteUnitPrice,
}: {
  quantity: string | number;
  unitCost: string;
  quoteUnitPrice?: string | null;
}) {
  const t = useTranslations('productSources');
  const quote = diyQuoteLineTotal(quantity, quoteUnitPrice);
  return (
    <div className="source-line-totals">
      <span className="source-line-total">
        {t('lineCost')}:{' '}
        {unitCost === '' || quantity === ''
          ? '—'
          : `¥${money(Number(quantity) * Number(unitCost))}`}
      </span>
      <span className="source-line-total source-line-quote">
        {t('quoteLineTotal')}: {quote === null ? t('quoteMissing') : `¥${quote}`}
      </span>
    </div>
  );
}

function CraftDesignFeeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('productSources');
  const presets = ['100', '120', '150'];
  const preset = presets.find((amount) => Number(amount) === Number(value));
  const [manual, setManual] = useState(preset === undefined);
  const showManual = manual || preset === undefined;

  return (
    <div className="source-field source-craft-fee-choice">
      <span>{t('craftDesignFee')}</span>
      <div className="source-craft-fee-controls">
        <Radio.Group
          aria-label={t('craftDesignFee')}
          value={showManual ? 'manual' : preset}
          options={[
            ...presets.map((amount) => ({ value: amount, label: `¥${amount}` })),
            { value: 'manual', label: t('manualCraftDesignFee') },
          ]}
          onChange={(event) => {
            const selection = event.target.value as string;
            setManual(selection === 'manual');
            if (selection !== 'manual') onChange(selection);
          }}
        />
        {showManual && (
          <InputNumber<string>
            aria-label={t('craftDesignFee') + ' - ' + t('manualCraftDesignFee')}
            stringMode
            prefix="¥"
            min="0"
            max="9999999999.99"
            precision={2}
            value={value}
            onChange={(amount) => onChange(amount ?? '0')}
          />
        )}
      </div>
    </div>
  );
}

function SourceFields({
  value,
  onChange,
  batches,
  distributors,
  materials,
  materialOptions,
  materialPreview,
  cabochons,
  onMaterialSearch,
  onCabochonSearch,
  allowOriginChange,
}: {
  value: ProductSourceInput;
  onChange: (value: ProductSourceInput) => void;
  batches: MaterialBatch[];
  distributors: DistributorPage['items'];
  materials: MaterialOption[];
  materialOptions: MaterialOption[];
  materialPreview: ReturnType<typeof useMaterialImagePreview>;
  cabochons: CabochonOption[];
  onMaterialSearch: (query: string) => void;
  onCabochonSearch: (query: string) => void;
  allowOriginChange: boolean;
}) {
  const t = useTranslations('productSources');
  const update = (fields: Partial<ProductSourceInput>) =>
    onChange({ ...value, ...fields } as ProductSourceInput);
  const fee =
    value.origin === 'DIY'
      ? (value.craftDesignFee ?? emptyCraftDesignFee())
      : emptyCraftDesignFee();
  const diyCost = value.origin === 'DIY' ? calculateDiyCost(value) : null;
  const diyQuote = value.origin === 'DIY' ? calculateDiyQuote(value) : null;

  return (
    <div className="product-source-fields">
      <div className="product-source-grid">
        <label className="source-field">
          <span>{t('origin')}</span>
          <Select
            value={value.origin}
            disabled={!allowOriginChange}
            onChange={(origin: ProductSourceInput['origin']) => onChange(initialSource(origin))}
            options={(['PURCHASED', 'DIY'] as const).map((origin) => ({
              value: origin,
              label: t(origin),
            }))}
          />
        </label>
        <label className="source-field">
          <span>{t('quantity')}</span>
          <InputNumber
            min={1}
            max={2147483647}
            precision={0}
            value={value.quantity}
            onChange={(quantity) => update({ quantity: quantity ?? 0 })}
          />
        </label>
      </div>
      {value.origin === 'PURCHASED' ? (
        <div className="product-source-grid">
          <label className="source-field">
            <span>{t('batch')}</span>
            <Select
              showSearch
              optionFilterProp="label"
              value={
                'batchId' in value.selection ? value.selection.batchId || undefined : '__new__'
              }
              onChange={(id: string) =>
                update({
                  selection:
                    id === '__new__'
                      ? { newBatch: { name: '', receivedAt: todayInChina(), notes: '' } }
                      : { batchId: id },
                })
              }
              options={[
                ...batches.map((batch) => ({ value: batch.id, label: batch.name })),
                { value: '__new__', label: t('newBatch') },
              ]}
            />
          </label>
          <label className="source-field">
            <span>{t('distributor')}</span>
            <Select
              showSearch
              optionFilterProp="label"
              value={value.distributorId || undefined}
              onChange={(distributorId) => update({ distributorId })}
              options={distributors.map((item) => ({ value: item.id, label: item.name }))}
            />
          </label>
          {'newBatch' in value.selection && value.selection.newBatch && (
            <>
              <label className="source-field">
                <span>{t('batchName')}</span>
                <Input
                  value={value.selection.newBatch.name}
                  maxLength={120}
                  onChange={(event) =>
                    update({
                      selection: {
                        newBatch: { ...value.selection.newBatch!, name: event.target.value },
                      },
                    })
                  }
                />
              </label>
              <label className="source-field">
                <span>{t('receivedAt')}</span>
                <Input
                  type="date"
                  value={value.selection.newBatch.receivedAt}
                  onChange={(event) =>
                    update({
                      selection: {
                        newBatch: { ...value.selection.newBatch!, receivedAt: event.target.value },
                      },
                    })
                  }
                />
              </label>
            </>
          )}
          <label className="source-field">
            <span>{t('unitCost')}</span>
            <InputNumber
              min={0}
              precision={2}
              value={value.unitCost === '' ? null : Number(value.unitCost)}
              onChange={(amount) => update({ unitCost: amount == null ? '' : String(amount) })}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="product-source-subheading">
            <strong>{t('materials')}</strong>
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                update({
                  materials: [
                    ...value.materials,
                    {
                      materialBatchEntryId: '',
                      usageUnit: 'BEAD',
                      quantity: '1',
                      unitCost: '',
                      quoteUnitPrice: null,
                    },
                  ],
                })
              }
            >
              {t('addMaterial')}
            </Button>
          </div>
          {value.materials.map((line, index) => {
            const selected = materials.find(
              (option) => option.entry.id === line.materialBatchEntryId,
            );
            const change = (fields: Partial<typeof line>) =>
              update({
                materials: value.materials.map((item, at) =>
                  at === index ? { ...item, ...fields } : item,
                ),
              });
            return (
              <div className="product-material-row-scroll" key={`material-${index}`}>
                <div className="product-material-row">
                  <div className="product-material-inputs">
                    <div className="source-field source-field-wide">
                      <span>{t('material')}</span>
                      <MaterialSourceSelect
                        options={materialOptions}
                        selected={selected}
                        value={line.materialBatchEntryId}
                        onSearch={onMaterialSearch}
                        preview={materialPreview}
                        onChange={(id) => {
                          const option = materials.find((item) => item.entry.id === id);
                          change({
                            materialBatchEntryId: id,
                            unitCost: option
                              ? (suggestedMaterialCost(option, line.usageUnit) ?? '')
                              : '',
                            quoteUnitPrice: option
                              ? suggestedMaterialQuote(option, line.usageUnit)
                              : null,
                          });
                        }}
                      />
                    </div>
                    <div className="source-field">
                      <span>{t('usageUnit')}</span>
                      <Radio.Group
                        className="source-material-unit-radio"
                        aria-label={t('usageUnit')}
                        value={line.usageUnit}
                        onChange={(event) => {
                          const usageUnit = event.target.value as typeof line.usageUnit;
                          change({
                            usageUnit,
                            unitCost: selected
                              ? (suggestedMaterialCost(selected, usageUnit) ?? '')
                              : '',
                            quoteUnitPrice: selected
                              ? suggestedMaterialQuote(selected, usageUnit)
                              : null,
                          });
                        }}
                        options={(['STRAND', 'BEAD', 'GRAM'] as const).map((unit) => ({
                          value: unit,
                          label: t(unit),
                        }))}
                      />
                    </div>
                    <label className="source-field">
                      <span>{t('usageQuantity')}</span>
                      <InputNumber
                        min={0.01}
                        precision={line.usageUnit === 'GRAM' ? 2 : 0}
                        value={line.quantity === '' ? null : Number(line.quantity)}
                        onChange={(quantity) =>
                          change({ quantity: quantity == null ? '' : String(quantity) })
                        }
                      />
                    </label>
                    <label className="source-field">
                      <span>{t('inputUnitCost')}</span>
                      <InputNumber
                        min={0}
                        precision={2}
                        value={line.unitCost === '' ? null : Number(line.unitCost)}
                        onChange={(amount) =>
                          change({ unitCost: amount == null ? '' : String(amount) })
                        }
                      />
                    </label>
                    <QuotePriceField
                      value={line.quoteUnitPrice}
                      onChange={(quoteUnitPrice) => change({ quoteUnitPrice })}
                    />
                    <LineTotals
                      quantity={line.quantity}
                      unitCost={line.unitCost}
                      quoteUnitPrice={line.quoteUnitPrice}
                    />
                    <Tooltip title={t('removeMaterial')}>
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('removeMaterial')}
                        onClick={() =>
                          update({ materials: value.materials.filter((_, at) => at !== index) })
                        }
                      />
                    </Tooltip>
                  </div>
                  {selected && (
                    <MaterialSourceSummary
                      key={selected.entry.id}
                      option={selected}
                      preview={materialPreview}
                    />
                  )}
                  {selected?.entry.unitPriceSource === 'ESTIMATED' &&
                    (line.usageUnit === selected.material.unit ||
                      (line.usageUnit === 'BEAD' &&
                        (selected.entry.childPriceSource === 'COUNT' ||
                          selected.entry.childPriceSource === 'WEIGHT'))) && (
                      <span className="material-input-help">{t('estimatedMaterialCost')}</span>
                    )}
                </div>
              </div>
            );
          })}
          <div className="product-source-subheading">
            <strong>{t('cabochons')}</strong>
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                update({
                  cabochons: [
                    ...value.cabochons,
                    { productId: '', quantity: 1, unitCost: '', quoteUnitPrice: null },
                  ],
                })
              }
            >
              {t('addCabochon')}
            </Button>
          </div>
          {value.cabochons.map((line, index) => {
            const change = (fields: Partial<typeof line>) =>
              update({
                cabochons: value.cabochons.map((item, at) =>
                  at === index ? { ...item, ...fields } : item,
                ),
              });
            return (
              <div className="product-source-line" key={`cabochon-${index}`}>
                <label className="source-field source-field-wide">
                  <span>{t('cabochon')}</span>
                  <Select
                    showSearch
                    filterOption={false}
                    onSearch={onCabochonSearch}
                    value={line.productId || undefined}
                    onChange={(id: string) => {
                      const option = cabochons.find((item) => item.product.id === id);
                      change({
                        productId: id,
                        unitCost: option?.product.cost?.totalCost ?? '',
                        quoteUnitPrice: option
                          ? (option.product.priceCents / 100).toFixed(2)
                          : null,
                      });
                    }}
                    options={cabochons.map((option) => ({
                      value: option.product.id,
                      label: option.label,
                    }))}
                  />
                </label>
                <label className="source-field">
                  <span>{t('usageQuantity')}</span>
                  <InputNumber
                    min={1}
                    precision={0}
                    value={line.quantity}
                    onChange={(quantity) => change({ quantity: quantity ?? 0 })}
                  />
                </label>
                <label className="source-field">
                  <span>{t('inputUnitCost')}</span>
                  <InputNumber
                    min={0}
                    precision={2}
                    value={line.unitCost === '' ? null : Number(line.unitCost)}
                    onChange={(amount) =>
                      change({ unitCost: amount == null ? '' : String(amount) })
                    }
                  />
                </label>
                <QuotePriceField
                  value={line.quoteUnitPrice}
                  onChange={(quoteUnitPrice) => change({ quoteUnitPrice })}
                />
                <LineTotals
                  quantity={line.quantity}
                  unitCost={line.unitCost}
                  quoteUnitPrice={line.quoteUnitPrice}
                />
                <Tooltip title={t('removeCabochon')}>
                  <Button
                    icon={<DeleteOutlined />}
                    aria-label={t('removeCabochon')}
                    onClick={() =>
                      update({ cabochons: value.cabochons.filter((_, at) => at !== index) })
                    }
                  />
                </Tooltip>
              </div>
            );
          })}
          <div className="product-source-subheading">
            <strong>{t('extraCosts')}</strong>
            <Button
              icon={<PlusOutlined />}
              onClick={() =>
                update({
                  extraCosts: [...value.extraCosts, { name: '', amount: '', quoteAmount: null }],
                })
              }
            >
              {t('addExtra')}
            </Button>
          </div>
          {value.extraCosts.map((line, index) => (
            <div className="product-source-line" key={`extra-${index}`}>
              <label className="source-field source-field-wide">
                <span>{t('costName')}</span>
                <Input
                  value={line.name}
                  maxLength={60}
                  onChange={(event) =>
                    update({
                      extraCosts: value.extraCosts.map((item, at) =>
                        at === index ? { ...item, name: event.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="source-field">
                <span>{t('costAmount')}</span>
                <InputNumber
                  min={0}
                  precision={2}
                  value={line.amount === '' ? null : Number(line.amount)}
                  onChange={(amount) =>
                    update({
                      extraCosts: value.extraCosts.map((item, at) =>
                        at === index
                          ? { ...item, amount: amount == null ? '' : String(amount) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <QuotePriceField
                label={t('extraQuoteAmount')}
                value={line.quoteAmount}
                onChange={(quoteAmount) =>
                  update({
                    extraCosts: value.extraCosts.map((item, at) =>
                      at === index ? { ...item, quoteAmount } : item,
                    ),
                  })
                }
              />
              <Tooltip title={t('removeExtra')}>
                <Button
                  icon={<DeleteOutlined />}
                  aria-label={t('removeExtra')}
                  onClick={() =>
                    update({ extraCosts: value.extraCosts.filter((_, at) => at !== index) })
                  }
                />
              </Tooltip>
            </div>
          ))}
          <div className="product-source-craft-fee">
            <div className="product-source-craft-fee-inputs">
              <CraftDesignFeeInput
                value={fee.unitAmount}
                onChange={(unitAmount) => update({ craftDesignFee: { ...fee, unitAmount } })}
              />
              {value.quantity > 1 && (
                <Checkbox
                  checked={fee.accumulateByQuantity}
                  onChange={(event) =>
                    update({
                      craftDesignFee: { ...fee, accumulateByQuantity: event.target.checked },
                    })
                  }
                >
                  {t('accumulateByQuantity')}
                </Checkbox>
              )}
              {fee.accumulateByQuantity && (
                <label className="source-field">
                  <span>{t('craftDesignTotal')}</span>
                  <InputNumber<string>
                    stringMode
                    prefix="¥"
                    min="0"
                    precision={2}
                    value={craftDesignFeeTotal(fee, value.quantity)}
                    onChange={(totalAmount) => update({ craftDesignFee: { ...fee, totalAmount } })}
                  />
                </label>
              )}
            </div>
            <div className="product-source-craft-fee-hint">
              <span>
                {t(
                  !fee.accumulateByQuantity
                    ? 'craftDesignOnce'
                    : fee.totalAmount === null
                      ? 'craftDesignAutomatic'
                      : 'craftDesignManual',
                )}
              </span>
              {fee.accumulateByQuantity && fee.totalAmount !== null && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => update({ craftDesignFee: { ...fee, totalAmount: null } })}
                >
                  {t('recalculateCraftDesign')}
                </Button>
              )}
            </div>
          </div>
          <div className="product-source-totals">
            <span>
              {t('perUnitCost')}: ¥{diyCost?.perUnitCost ?? '—'}
            </span>
            {value.quantity > 1 && (
              <strong>
                {t('runTotal')}: ¥{diyCost?.totalCost ?? '—'}
              </strong>
            )}
          </div>
          <div className="product-source-totals product-source-quote-totals">
            <span>
              {t('perUnitQuote')}: {diyQuote ? `¥${diyQuote.perUnitQuote}` : t('quoteIncomplete')}
            </span>
            {value.quantity > 1 && (
              <strong>
                {t('totalQuote')}: {diyQuote ? `¥${diyQuote.totalQuote}` : t('quoteIncomplete')}
              </strong>
            )}
          </div>
          <span className="material-input-help">{t('quoteHelp')}</span>
        </>
      )}
      <label className="source-field source-field-notes">
        <span>{t('notes')}</span>
        <Input.TextArea
          rows={2}
          maxLength={10000}
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
        />
      </label>
    </div>
  );
}

export function ProductSourceSection({
  product,
  value,
  onChange,
  categories,
  onProductChanged,
}: {
  product: Product | null;
  value: ProductSourceInput;
  onChange: (value: ProductSourceInput) => void;
  categories: Category[];
  onProductChanged: (product: Product) => void;
}) {
  const t = useTranslations('productSources');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [batches, setBatches] = useState<MaterialBatch[]>([]);
  const [distributors, setDistributors] = useState<DistributorPage['items']>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const materialPreview = useMaterialImagePreview();
  const [cabochons, setCabochons] = useState<CabochonOption[]>([]);
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductSourceInput>(initialSource());
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [delta, setDelta] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const materialRequest = useRef(0);
  const cabochonRequest = useRef(0);
  const cabochonCategoryId = categories.find((category) => category.name === '蛋面')?.id;

  const searchMaterials = useCallback(
    (query: string) => {
      const request = ++materialRequest.current;
      apiFetch<MaterialPage>(`/api/materials?pageSize=50&q=${encodeURIComponent(query)}`)
        .then((page) => {
          if (request !== materialRequest.current) return;
          const options = page.items.flatMap((material) =>
            material.batchEntries.map((entry) => ({
              material,
              entry,
              label: `${material.name} · ${entry.batch.name}`,
            })),
          );
          setMaterialOptions(options);
          // Keep selected materials available when another row searches for different materials.
          setMaterials((current) => [
            ...options,
            ...current.filter(
              (item) => !options.some((option) => option.entry.id === item.entry.id),
            ),
          ]);
        })
        .catch(() => message.error(t('invalid')));
    },
    [message, t],
  );

  const searchCabochons = useCallback(
    (query: string) => {
      if (!cabochonCategoryId) return;
      const request = ++cabochonRequest.current;
      apiFetch<ProductPage>(
        `/api/products?categoryId=${cabochonCategoryId}&pageSize=50&q=${encodeURIComponent(query)}`,
      )
        .then((page) => {
          if (request !== cabochonRequest.current) return;
          setCabochons(
            page.items.map((item) => ({ product: item, label: `${item.name} · ${item.code}` })),
          );
        })
        .catch(() => message.error(t('invalid')));
    },
    [cabochonCategoryId, message, t],
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<MaterialBatch[]>('/api/material-batches'),
      apiFetch<DistributorPage>('/api/distributors'),
    ])
      .then(([batchList, distributorPage]) => {
        if (!active) return;
        setBatches(batchList);
        setDistributors(distributorPage.items);
      })
      .catch(() => message.error(t('invalid')));
    return () => {
      active = false;
    };
  }, [message, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => searchMaterials(''), 0);
    return () => window.clearTimeout(timer);
  }, [searchMaterials]);

  useEffect(() => {
    if (!cabochonCategoryId) return;
    const timer = window.setTimeout(() => searchCabochons(''), 0);
    return () => window.clearTimeout(timer);
  }, [cabochonCategoryId, searchCabochons]);

  function open(mode: EditorMode, id?: string) {
    if (mode === 'edit' && product) {
      const purchase = product.purchaseEntries.find((entry) => entry.id === id);
      const run = product.diyRuns.find((entry) => entry.id === id);
      if (purchase) {
        setDraft({
          origin: 'PURCHASED',
          selection: { batchId: purchase.batchId },
          distributorId: purchase.distributorId,
          quantity: purchase.quantity,
          unitCost: purchase.unitCost,
          notes: purchase.notes,
        });
      } else if (run) {
        setDraft({
          origin: 'DIY',
          quantity: run.quantity,
          notes: run.notes,
          materials: run.materialLines.map((line) => ({
            materialBatchEntryId: line.materialBatchEntryId,
            usageUnit: line.usageUnit,
            quantity: line.quantity,
            unitCost: line.unitCost,
            quoteUnitPrice: line.quoteUnitPrice,
          })),
          cabochons: run.cabochonLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            quoteUnitPrice: line.quoteUnitPrice,
          })),
          extraCosts: run.extraCosts,
          craftDesignFee: run.craftDesignFee ?? emptyCraftDesignFee(),
        });
        setMaterials((current) => [
          ...run.materialLines.map((line) => ({
            entry: line.materialBatchEntry,
            material: {
              ...line.materialBatchEntry.material,
              unit: line.materialBatchEntry.material.unit,
            } as Material,
            label: `${line.materialBatchEntry.material.name} · ${line.materialBatchEntry.batch.name}`,
          })),
          ...current.filter(
            (option) =>
              !run.materialLines.some((line) => line.materialBatchEntryId === option.entry.id),
          ),
        ]);
        setCabochons((current) => [
          ...run.cabochonLines.map((line) => ({
            product: { ...line.product, cost: null } as Product,
            label: `${line.product.name} · ${line.product.code}`,
          })),
          ...current.filter(
            (option) => !run.cabochonLines.some((line) => line.productId === option.product.id),
          ),
        ]);
      }
    } else {
      setDraft(
        initialSource(
          mode === 'correct' && product?.origin === 'PURCHASED'
            ? 'DIY'
            : (product?.origin ?? 'PURCHASED'),
        ),
      );
    }
    setSourceId(id ?? null);
    setMode(mode);
  }

  async function refreshProduct() {
    if (!product) return;
    onProductChanged(await apiFetch<Product>(`/api/products/${product.id}`));
  }

  async function saveSource() {
    if (!product || !mode || !productSourceSchema.safeParse(draft).success) {
      message.error(t('invalid'));
      return;
    }
    setSaving(true);
    try {
      const url =
        mode === 'correct'
          ? `/api/products/${product.id}/origin`
          : sourceId
            ? `/api/products/${product.id}/sources/${sourceId}`
            : `/api/products/${product.id}/sources`;
      await apiFetch(url, { method: mode === 'add' ? 'POST' : 'PUT', body: JSON.stringify(draft) });
      await refreshProduct();
      setMode(null);
      message.success(common('saved'));
    } catch (error) {
      message.error(
        error instanceof ClientApiError && error.code === 'PRODUCT_STOCK_OUT_OF_RANGE'
          ? t('stockError')
          : t('invalid'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!product) return;
    try {
      await apiFetch(`/api/products/${product.id}/sources/${id}`, { method: 'DELETE' });
      await refreshProduct();
      message.success(common('deleted'));
    } catch (error) {
      message.error(
        error instanceof ClientApiError && error.code === 'PRODUCT_STOCK_OUT_OF_RANGE'
          ? t('stockError')
          : t('invalid'),
      );
    }
  }

  async function adjust() {
    if (!product || !Number.isInteger(delta) || !delta || !reason.trim()) {
      message.error(t('invalid'));
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/products/${product.id}/stock-adjustments`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason: reason.trim() }),
      });
      await refreshProduct();
      setAdjustOpen(false);
      setDelta(null);
      setReason('');
      message.success(common('saved'));
    } catch (error) {
      message.error(
        error instanceof ClientApiError && error.code === 'PRODUCT_STOCK_OUT_OF_RANGE'
          ? t('stockError')
          : t('invalid'),
      );
    } finally {
      setSaving(false);
    }
  }

  const records = product
    ? [
        ...product.purchaseEntries.map((entry) => ({
          id: entry.id,
          type: 'PURCHASED' as const,
          quantity: entry.quantity,
          unitCost: entry.unitCost,
          quote: null as string | null,
          detail: `${entry.batch.name} · ${entry.distributor.name}`,
          createdAt: entry.createdAt,
        })),
        ...product.diyRuns.map((run) => ({
          id: run.id,
          type: 'DIY' as const,
          quantity: run.quantity,
          unitCost: run.perUnitCost,
          quote: run.totalQuote,
          detail: `${run.materialLines.length} ${t('materials')} · ${run.cabochonLines.length} ${t('cabochons')}`,
          createdAt: run.createdAt,
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <section className="editor-block">
      <div className="product-source-heading">
        <h2>{t('title')}</h2>
        {product && <Tag>{product.origin ? t(product.origin) : t('legacy')}</Tag>}
      </div>
      {!product ? (
        <SourceFields
          value={value}
          onChange={onChange}
          batches={batches}
          distributors={distributors}
          materials={materials}
          materialOptions={materialOptions}
          materialPreview={materialPreview}
          cabochons={cabochons}
          onMaterialSearch={searchMaterials}
          onCabochonSearch={searchCabochons}
          allowOriginChange
        />
      ) : (
        <>
          <div className="product-source-actions">
            <span>{t('currentStock', { count: product.stock })}</span>
            <Button icon={<PlusOutlined />} onClick={() => open('add')}>
              {t('addRecord')}
            </Button>
            <Button
              onClick={() => {
                setDelta(null);
                setReason('');
                setAdjustOpen(true);
              }}
            >
              {t('adjustStock')}
            </Button>
            <Button onClick={() => open('correct')}>{t('correctOrigin')}</Button>
          </div>
          <Table
            rowKey="id"
            size="small"
            pagination={CLIENT_TABLE_PAGINATION}
            scroll={{ x: 670 }}
            dataSource={records}
            locale={{ emptyText: t('empty') }}
            columns={[
              {
                title: t('origin'),
                dataIndex: 'type',
                render: (type: 'PURCHASED' | 'DIY') => t(type),
              },
              { title: t('batch'), dataIndex: 'detail' },
              { title: t('quantity'), dataIndex: 'quantity' },
              {
                title: t('unitCost'),
                dataIndex: 'unitCost',
                render: (amount: string) => `¥${amount}`,
              },
              {
                title: t('customerQuote'),
                dataIndex: 'quote',
                render: (amount: string | null, row) =>
                  row.type === 'DIY'
                    ? amount === null
                      ? t('quoteIncomplete')
                      : `¥${amount}`
                    : '—',
              },
              {
                title: t('recordDate'),
                dataIndex: 'createdAt',
                render: (date: string) => date.slice(0, 10),
              },
              {
                title: '',
                key: 'actions',
                render: (_, row) => (
                  <div className="product-source-row-actions">
                    <Tooltip title={t('editRecord')}>
                      <Button
                        icon={<EditOutlined />}
                        size="small"
                        aria-label={t('editRecord')}
                        onClick={() => open('edit', row.id)}
                      />
                    </Tooltip>
                    <Popconfirm title={t('deleteRecord')} onConfirm={() => void remove(row.id)}>
                      <Tooltip title={t('deleteRecord')}>
                        <Button
                          icon={<DeleteOutlined />}
                          size="small"
                          danger
                          aria-label={t('deleteRecord')}
                        />
                      </Tooltip>
                    </Popconfirm>
                  </div>
                ),
              },
            ]}
          />
          {product.stockAdjustments.length > 0 && (
            <div className="product-source-adjustments">
              <strong>{t('history')}</strong>
              {product.stockAdjustments.map((item) => (
                <div key={item.id}>
                  <span>{item.createdAt.slice(0, 10)}</span>
                  <span>{item.delta > 0 ? `+${item.delta}` : item.delta}</span>
                  <span>{item.reason}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Drawer
        title={
          mode === 'correct'
            ? t('correctOrigin')
            : mode === 'edit'
              ? t('editRecord')
              : t('addRecord')
        }
        open={mode !== null}
        onClose={() => setMode(null)}
        width="min(760px, 100vw)"
        extra={
          <Button type="primary" loading={saving} onClick={() => void saveSource()}>
            {t('save')}
          </Button>
        }
      >
        {mode === 'correct' && (
          <Alert
            type="warning"
            showIcon
            message={t('correctWarning')}
            className="product-source-warning"
          />
        )}
        <SourceFields
          key={`${mode ?? 'closed'}-${sourceId ?? 'new'}`}
          value={draft}
          onChange={setDraft}
          batches={batches}
          distributors={distributors}
          materials={materials}
          materialOptions={materialOptions}
          materialPreview={materialPreview}
          cabochons={cabochons}
          onMaterialSearch={searchMaterials}
          onCabochonSearch={searchCabochons}
          allowOriginChange={mode === 'correct'}
        />
      </Drawer>
      <Drawer
        title={t('adjustStock')}
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        width="min(420px, 100vw)"
        extra={
          <Button type="primary" loading={saving} onClick={() => void adjust()}>
            {t('save')}
          </Button>
        }
      >
        <div className="product-source-fields">
          <p>{t('currentStock', { count: product?.stock ?? 0 })}</p>
          <label className="source-field">
            <span>{t('delta')}</span>
            <InputNumber
              min={-2147483647}
              max={2147483647}
              precision={0}
              value={delta}
              onChange={setDelta}
            />
          </label>
          <label className="source-field">
            <span>{t('reason')}</span>
            <Input.TextArea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
      </Drawer>
      {materialPreview.viewer}
    </section>
  );
}
