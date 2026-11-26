'use client';

import { SchemePriceFields } from './priceSchemes/schemePriceFields';
import { priceContext } from '@/lib/price-schemes/variables';
import { PricingGroupFields } from '@/components/productEditor/pricingGroupFields';
import { DiySalePricing, DiySalePricingFooter } from '@/components/productEditor/diySalePricing';
import { useDiySalePricing } from '@/components/productEditor/useDiySalePricing';

import { DiyPicker, type PickerPreferences } from '@/components/diyPicker/diyPicker';
import { applyPickerSelection, preferredMaterialUsageUnit } from '@/lib/diy-picker/draft';
import type { PickerKind, PickerSelection } from '@/lib/diy-picker/contracts';

import { formatAmount } from '@/lib/format-money';

import { Sensitive } from '@/components/privacyMode';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  ConfigProvider,
  Input,
  InputNumber,
  Popconfirm,
  Radio,
  Select,
  Tag,
  Tooltip,
} from 'antd';
import { CompactFields } from '@/components/responsive/compactFields';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DateInput } from '@/components/date-input';
import { PaginatedTable } from '@/components/paginated-table';
import { StockAdjustmentDrawer } from '@/components/inventory/stockAdjustmentDrawer';
import { StockHistory } from '@/components/inventory/stockHistory';
import { DistributorSelect } from '@/components/distributorSelect/distributorSelect';
import { SilverCostFields } from '@/components/productEditor/silverCostFields';
import { CommonFeeFields } from '@/components/productEditor/commonFeeFields';
import { ResponsiveDrawer as Drawer } from '@/components/responsive/responsiveDialog';
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
import { DEFAULT_SILVER_PRICING } from '@/lib/silver-cost';
import {
  calculateDiyCost,
  calculateDiyQuote,
  diyQuoteLineTotal,
  craftDesignFeeTotal,
  emptyCraftDesignFee,
} from '@/lib/product-diy-cost';
import { todayInChina } from './materialManagement/batchSelector';
import { PurchaseBatchSelect } from './materialManagement/purchaseBatchSelect';
import diyStyles from './productDiyEntry.module.css';
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
        pricingLines: [],
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
      <Sensitive>
        <span className="source-line-total">
          {t('lineCost')}:{' '}
          {unitCost === '' || quantity === ''
            ? '—'
            : `¥${money(Number(quantity) * Number(unitCost))}`}
        </span>
      </Sensitive>
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
            ...presets.map((amount) => ({ value: amount, label: `¥${formatAmount(amount)}` })),
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
  excludeProductId,
  onPickerOptions,
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
  excludeProductId?: string;
  onPickerOptions: (selections: PickerSelection[]) => void;
}) {
  const [picker, setPicker] = useState<{ kind: PickerKind; index?: number } | null>(null);
  const [cabochonOpen, setCabochonOpen] = useState<number | null>(null);
  const [pickerPreferences, setPickerPreferences] = useState<Record<PickerKind, PickerPreferences>>(
    { materials: {}, cabochons: {} },
  );
  const t = useTranslations('productSources');
  const update = (fields: Partial<ProductSourceInput>) =>
    onChange({ ...value, ...fields } as ProductSourceInput);
  const fee =
    value.origin === 'DIY'
      ? (value.craftDesignFee ?? emptyCraftDesignFee())
      : emptyCraftDesignFee();
  const diyCost = value.origin === 'DIY' ? calculateDiyCost(value) : null;
  const materialCost =
    value.origin === 'DIY' ? calculateDiyCost({ ...value, extraCosts: [] }) : null;
  const materialQuote =
    value.origin === 'DIY'
      ? calculateDiyQuote({ ...value, extraCosts: [], craftDesignFee: emptyCraftDesignFee() })
      : null;
  const diyQuote = value.origin === 'DIY' ? calculateDiyQuote(value) : null;

  return (
    <div className="product-source-fields">
      {picker && value.origin === 'DIY' && (
        <DiyPicker
          kind={picker.kind}
          single={picker.index !== undefined}
          preferences={pickerPreferences[picker.kind]}
          onPreferences={(next) =>
            setPickerPreferences((current) => ({ ...current, [picker.kind]: next }))
          }
          existingIds={
            picker.kind === 'materials'
              ? value.materials.map((line) => line.materialBatchEntryId)
              : value.cabochons.map((line) => line.productId)
          }
          excludeProductId={excludeProductId}
          distributors={distributors}
          onClose={() => setPicker(null)}
          onConfirm={(selections) => {
            onPickerOptions(selections);
            onChange(applyPickerSelection(value, selections, picker.index));
            setPicker(null);
          }}
        />
      )}

      <CompactFields className="product-source-grid">
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
      </CompactFields>
      {value.origin === 'PURCHASED' ? (
        <CompactFields className="product-source-grid">
          <div className="source-field source-field-wide">
            <span>{t('batch')}</span>
            <PurchaseBatchSelect
              aria-label={t('batch')}
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
              batches={batches}
              createLabel={t('newBatch')}
            />
          </div>
          <label className="source-field source-field-wide">
            <span>{t('distributor')}</span>
            <DistributorSelect
              aria-label={t('distributor')}
              value={value.distributorId || undefined}
              onChange={(distributorId) => update({ distributorId })}
              distributors={distributors}
            />
          </label>
          {'newBatch' in value.selection && value.selection.newBatch && (
            <>
              <label className="source-field source-field-wide">
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
              <label className="source-field source-field-wide">
                <span>{t('receivedAt')}</span>
                <DateInput
                  aria-label={t('receivedAt')}
                  value={value.selection.newBatch.receivedAt}
                  onChange={(date) =>
                    update({
                      selection: {
                        newBatch: { ...value.selection.newBatch!, receivedAt: date },
                      },
                    })
                  }
                />
              </label>
            </>
          )}
          <Sensitive>
            <label className="source-field">
              <span>{t('unitCost')}</span>
              <InputNumber
                min={0}
                precision={2}
                value={value.unitCost === '' ? null : Number(value.unitCost)}
                onChange={(amount) => update({ unitCost: amount == null ? '' : String(amount) })}
              />
            </label>
          </Sensitive>
        </CompactFields>
      ) : (
        <>
          <div className="product-source-subheading">
            <strong>{t('materials')}</strong>
            <Button icon={<PlusOutlined />} onClick={() => setPicker({ kind: 'materials' })}>
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
              <div className="product-material-row-container" key={`material-${index}`}>
                <div className="product-material-row-heading">
                  <strong>{t('materialNumber', { number: index + 1 })}</strong>
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
                <div className="product-material-row">
                  <div className="product-material-inputs">
                    <div className="source-field source-field-wide">
                      <MaterialSourceSelect
                        options={materialOptions}
                        selected={selected}
                        value={line.materialBatchEntryId}
                        onSearch={onMaterialSearch}
                        preview={materialPreview}
                        onBrowse={() => setPicker({ kind: 'materials', index })}
                        onChange={(id) => {
                          const option = materials.find((item) => item.entry.id === id);
                          const usageUnit = option
                            ? preferredMaterialUsageUnit(option, line.usageUnit)
                            : line.usageUnit;
                          change({
                            usageUnit,
                            materialBatchEntryId: id,
                            unitCost: option
                              ? (suggestedMaterialCost(option, usageUnit) ?? '')
                              : '',
                            quoteUnitPrice: option
                              ? suggestedMaterialQuote(option, usageUnit)
                              : null,
                          });
                        }}
                      />
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setPicker({ kind: 'materials', index })}
                      >
                        {t('browseAll')}
                      </Button>
                    </div>
                    <div className="source-field source-material-unit-field">
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
                        options={(selected?.material.unit === 'GRAM'
                          ? (['GRAM'] as const)
                          : (['STRAND', 'BEAD', 'GRAM'] as const)
                        ).map((unit) => ({
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
                    <Sensitive>
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
                    </Sensitive>
                    <QuotePriceField
                      value={line.quoteUnitPrice}
                      onChange={(quoteUnitPrice) => change({ quoteUnitPrice })}
                    />
                    <LineTotals
                      quantity={line.quantity}
                      unitCost={line.unitCost}
                      quoteUnitPrice={line.quoteUnitPrice}
                    />
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
          <PricingGroupFields
            value={value.pricingLines ?? []}
            onChange={(pricingLines) => update({ pricingLines })}
          />
          {value.silverCost !== undefined && (
            <SilverCostFields
              value={value.silverCost}
              onChange={(silverCost) => update({ silverCost })}
            />
          )}
          <div className="product-source-subheading">
            <strong>{t('cabochons')}</strong>
            <Button icon={<PlusOutlined />} onClick={() => setPicker({ kind: 'cabochons' })}>
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
                <div className="source-field source-field-wide">
                  <span>{t('cabochon')}</span>
                  <Select
                    aria-label={t('cabochon')}
                    open={cabochonOpen === index}
                    onOpenChange={(open) => setCabochonOpen(open ? index : null)}
                    popupRender={(menu) => (
                      <>
                        {menu}
                        <Button
                          block
                          type="link"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setCabochonOpen(null);
                            setPicker({ kind: 'cabochons', index });
                          }}
                        >
                          {t('browseAll')}
                        </Button>
                      </>
                    )}
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
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setCabochonOpen(null);
                      setPicker({ kind: 'cabochons', index });
                    }}
                  >
                    {t('browseAll')}
                  </Button>
                </div>
                <label className="source-field">
                  <span>{t('usageQuantity')}</span>
                  <InputNumber
                    min={1}
                    precision={0}
                    value={line.quantity}
                    onChange={(quantity) => change({ quantity: quantity ?? 0 })}
                  />
                </label>
                <Sensitive>
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
                </Sensitive>
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
                    danger
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
          <div className="product-source-material-totals source-line-totals">
            <Sensitive>
              <span className="source-line-total">
                {t('materialSilverCostTotal')}:{' '}
                {materialCost ? `¥${materialCost.perUnitCost}` : '—'}
              </span>
            </Sensitive>
            <span className="source-line-total source-line-quote">
              {t('materialQuoteTotal')}:{' '}
              {materialQuote ? `¥${materialQuote.perUnitQuote}` : t('quoteMissing')}
            </span>
          </div>
          <CommonFeeFields
            value={value.extraCosts}
            onChange={(extraCosts) => update({ extraCosts })}
          />
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
          <div className="product-source-summary">
            <Sensitive>
              <div className="product-source-summary-column">
                <span>{t('perUnitCost')}</span>
                <strong>{diyCost ? `¥${diyCost.perUnitCost}` : '—'}</strong>
                {value.quantity > 1 && (
                  <div className="product-source-summary-run">
                    <span>{t('runTotal')}</span>
                    <strong>{diyCost ? `¥${diyCost.totalCost}` : '—'}</strong>
                  </div>
                )}
              </div>
            </Sensitive>
            <div className="product-source-summary-column product-source-quote-totals">
              <span>{t('perUnitQuote')}</span>
              <strong>{diyQuote ? `¥${diyQuote.perUnitQuote}` : t('quoteIncomplete')}</strong>
              {value.quantity > 1 && (
                <div className="product-source-summary-run">
                  <span>{t('totalQuote')}</span>
                  <strong>{diyQuote ? `¥${diyQuote.totalQuote}` : t('quoteIncomplete')}</strong>
                </div>
              )}
            </div>
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

function diySourceDraft(run: Product['diyRuns'][number]): ProductSourceInput {
  return {
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
    pricingLines: (run.pricingLines ?? []).map((line) => ({
      id: line.id,
      groupId: line.groupId,
      publicationId: line.publicationId,
      costBasisToken: line.costBasisToken,
      quantity: line.quantity,
      unitCost: line.unitCost,
      quoteUnitPrice: line.quoteUnitPrice,
    })),
    extraCosts: run.extraCosts,
    silverCost:
      run.legacySilver === false
        ? undefined
        : (run.silverCost ?? { weightGrams: '0', ...DEFAULT_SILVER_PRICING }),
    craftDesignFee: run.craftDesignFee ?? emptyCraftDesignFee(),
  };
}

function diyMaterialOptions(run: Product['diyRuns'][number]): MaterialOption[] {
  return run.materialLines.map((line) => ({
    entry: line.materialBatchEntry,
    material: {
      ...line.materialBatchEntry.material,
      unit: line.materialBatchEntry.material.unit,
    } as Material,
    label: `${line.materialBatchEntry.material.name} · ${line.materialBatchEntry.batch.name}`,
  }));
}

function diyCabochonOptions(run: Product['diyRuns'][number]): CabochonOption[] {
  return run.cabochonLines.map((line) => ({
    product: { ...line.product, cost: null } as Product,
    label: `${line.product.name} · ${line.product.code}`,
  }));
}

export function ProductSourceSection({
  product,
  value,
  onChange,
  categories,
  onProductChanged,
  quickEdit = false,
  initialSourceId,
  onEditorClose,
}: {
  product: Product | null;
  value: ProductSourceInput;
  onChange: (value: ProductSourceInput) => void;
  categories: Category[];
  onProductChanged: (product: Product) => void;
  quickEdit?: boolean;
  initialSourceId?: string;
  onEditorClose?: () => void;
}) {
  const t = useTranslations('productSources');
  const common = useTranslations('common');
  const { message } = App.useApp();
  const [batches, setBatches] = useState<MaterialBatch[]>([]);
  const [distributors, setDistributors] = useState<DistributorPage['items']>([]);
  const initialPurchase = product?.purchaseEntries.find((entry) => entry.id === initialSourceId);
  const initialRun = initialSourceId
    ? product?.diyRuns.find((run) => run.id === initialSourceId)
    : quickEdit
      ? product?.diyRuns[0]
      : undefined;
  const [materials, setMaterials] = useState<MaterialOption[]>(() =>
    initialRun ? diyMaterialOptions(initialRun) : [],
  );
  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const materialPreview = useMaterialImagePreview();
  const [cabochons, setCabochons] = useState<CabochonOption[]>(() =>
    initialRun ? diyCabochonOptions(initialRun) : [],
  );
  function rememberPickerOptions(selections: PickerSelection[]) {
    const materialSelections = selections.flatMap((selection) =>
      selection.kind === 'materials'
        ? [{ ...selection, label: `${selection.material.name} · ${selection.entry.batch.name}` }]
        : [],
    );
    const productSelections = selections.flatMap((selection) =>
      selection.kind === 'cabochons'
        ? [
            {
              product: selection.product,
              label: `${selection.product.name} · ${selection.product.code}`,
            },
          ]
        : [],
    );
    setMaterials((current) => [
      ...materialSelections,
      ...current.filter(
        (item) => !materialSelections.some((selection) => selection.entry.id === item.entry.id),
      ),
    ]);
    setMaterialOptions((current) => [
      ...materialSelections,
      ...current.filter(
        (item) => !materialSelections.some((selection) => selection.entry.id === item.entry.id),
      ),
    ]);
    setCabochons((current) => [
      ...productSelections,
      ...current.filter(
        (item) => !productSelections.some((selection) => selection.product.id === item.product.id),
      ),
    ]);
  }
  const [mode, setMode] = useState<EditorMode | null>(
    initialRun || initialPurchase ? 'edit' : quickEdit ? 'add' : null,
  );
  const [sourceId, setSourceId] = useState<string | null>(
    initialRun?.id ?? initialPurchase?.id ?? null,
  );
  const [draft, setDraft] = useState<ProductSourceInput>(() =>
    initialRun
      ? diySourceDraft(initialRun)
      : initialPurchase
        ? {
            origin: 'PURCHASED',
            selection: { batchId: initialPurchase.batchId },
            distributorId: initialPurchase.distributorId,
            quantity: initialPurchase.quantity,
            unitCost: initialPurchase.unitCost,
            notes: initialPurchase.notes,
          }
        : initialSource(quickEdit ? 'DIY' : 'PURCHASED'),
  );
  const pricing = useDiySalePricing(draft, product);
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const materialRequest = useRef(0);
  const cabochonRequest = useRef(0);
  const cabochonCategoryId = categories.find((category) => category.name === '蛋面')?.id;

  const searchMaterials = useCallback(
    (query: string) => {
      const request = ++materialRequest.current;
      apiFetch<MaterialPage>(
        `/api/materials?pricing=DIY&pageSize=50&q=${encodeURIComponent(query)}`,
      )
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
          const options = page.items
            .filter((item) => item.id !== product?.id)
            .map((item) => ({
              product: item,
              label: `${item.name} · ${item.code}`,
            }));
          setCabochons((current) => [
            ...options,
            ...current.filter(
              (option) => !options.some((item) => item.product.id === option.product.id),
            ),
          ]);
        })
        .catch(() => message.error(t('invalid')));
    },
    [cabochonCategoryId, message, t, product?.id],
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
        const nextDraft = diySourceDraft(run);
        setDraft(nextDraft);
        if (quickEdit) pricing.reset(nextDraft);
        setMaterials((current) => [
          ...diyMaterialOptions(run),
          ...current.filter(
            (option) =>
              !run.materialLines.some((line) => line.materialBatchEntryId === option.entry.id),
          ),
        ]);
        setCabochons((current) => [
          ...diyCabochonOptions(run),
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

  function closeEditor() {
    if (saving) return;
    const close = () => {
      setMode(null);
      onEditorClose?.();
    };
    if (quickEdit) pricing.confirmDiscard(close);
    else close();
  }

  async function refreshProduct() {
    if (!product) return;
    onProductChanged(await apiFetch<Product>(`/api/products/${product.id}`));
  }

  async function saveSource() {
    if (saving) return;
    if (quickEdit && pricing.payload === null) {
      message.error(t('salePricingInvalid'));
      return;
    }
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
      const body =
        quickEdit && pricing.edited
          ? {
              source: draft,
              pricing: pricing.payload,
            }
          : draft;
      const saved = await apiFetch<
        Pick<
          Product,
          | 'stock'
          | 'priceCents'
          | 'saleManual'
          | 'saleRule'
          | 'saleRuleValue'
          | 'updatedAt'
          | 'purchaseEntries'
          | 'diyRuns'
          | 'stockAdjustments'
        >
      >(url, { method: mode === 'add' ? 'POST' : 'PUT', body: JSON.stringify(body) });
      if (quickEdit) onProductChanged({ ...product, ...saved });
      await refreshProduct();
      setMode(null);
      onEditorClose?.();
      message.success(common('saved'));
    } catch (error) {
      message.error(
        error instanceof ClientApiError && error.code === 'PRODUCT_PRICE_CHANGED'
          ? t('salePriceChanged')
          : error instanceof ClientApiError && error.code === 'PRODUCT_STOCK_OUT_OF_RANGE'
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
          detail: `${run.materialLines.length + (run.pricingLines?.length ?? 0)} ${t('materials')} · ${run.cabochonLines.length} ${t('cabochons')}`,
          createdAt: run.createdAt,
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <section className={quickEdit ? undefined : 'editor-block'}>
      {!quickEdit && (
        <>
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
              onPickerOptions={rememberPickerOptions}
              onMaterialSearch={searchMaterials}
              onCabochonSearch={searchCabochons}
              allowOriginChange
            />
          ) : (
            <>
              <div className="product-source-actions">
                <span>{t('currentStock', { count: product.stock })}</span>
                {records.length > 0 && (
                  <Button icon={<EditOutlined />} onClick={() => open('edit', records[0].id)}>
                    {product.origin === 'DIY' ? t('diyMaterialsConfiguration') : t('editRecord')}
                  </Button>
                )}
                <Button icon={<PlusOutlined />} onClick={() => open('add')}>
                  {t('addRecord')}
                </Button>
                <Button
                  onClick={() => {
                    setAdjustOpen(true);
                  }}
                >
                  {t('adjustStock')}
                </Button>
                <Button onClick={() => open('correct')}>{t('correctOrigin')}</Button>
              </div>
              <PaginatedTable
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
                    render: (amount: string) => <Sensitive>{`¥${formatAmount(amount)}`}</Sensitive>,
                  },
                  {
                    title: t('customerQuote'),
                    dataIndex: 'quote',
                    render: (amount: string | null, row) =>
                      row.type === 'DIY'
                        ? amount === null
                          ? t('quoteIncomplete')
                          : `¥${formatAmount(amount)}`
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
              <StockHistory records={product.stockAdjustments} />
            </>
          )}
        </>
      )}
      <Drawer
        title={
          quickEdit
            ? `${t('diyConfiguration')} · ${product?.name ?? ''}`
            : mode === 'correct'
              ? t('correctOrigin')
              : mode === 'edit'
                ? t('editRecord')
                : t('addRecord')
        }
        open={mode !== null}
        onClose={closeEditor}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        width="min(1280px, 100vw)"
        extra={
          !quickEdit && (
            <Button type="primary" loading={saving} onClick={() => void saveSource()}>
              {t('save')}
            </Button>
          )
        }
        footer={
          quickEdit && product ? (
            <DiySalePricingFooter
              summary={pricing.summary}
              currentPrice={product.priceCents}
              saving={saving}
              valid={pricing.payload !== null}
              onSave={() => void saveSource()}
            />
          ) : undefined
        }
      >
        {quickEdit && product && product.diyRuns.length > 1 && (
          <label className={diyStyles.recordPicker}>
            <span>{t('diyRecord')}</span>
            <Select
              value={sourceId}
              disabled={saving}
              onChange={(id: string) => pricing.confirmDiscard(() => open('edit', id))}
              options={product.diyRuns.map((run, index) => ({
                value: run.id,
                label: t('diyRecordOption', {
                  date: run.createdAt.slice(0, 10),
                  quantity: run.quantity,
                  number: product.diyRuns.length - index,
                }),
              }))}
            />
          </label>
        )}
        {mode === 'correct' && (
          <Alert
            type="warning"
            showIcon
            message={t('correctWarning')}
            className="product-source-warning"
          />
        )}
        <ConfigProvider componentDisabled={saving}>
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
            excludeProductId={product?.id}
            onPickerOptions={rememberPickerOptions}
            onMaterialSearch={searchMaterials}
            onCabochonSearch={searchCabochons}
            allowOriginChange={mode === 'correct'}
          />
        </ConfigProvider>
        {quickEdit && product && (
          <>
            <DiySalePricing
              key={sourceId ?? 'new'}
              summary={pricing.summary}
              currentPrice={product.priceCents}
              value={pricing.value}
              onChange={pricing.changePricing}
              valid={pricing.payload !== null}
              disabled={saving}
              multipleRuns={product.diyRuns.length > 1}
            />
            <SchemePriceFields
              value={pricing.schemePrices}
              onChange={pricing.changeSchemePrices}
              disabled={saving}
              saved={product.schemePrices}
              context={priceContext(
                false,
                null,
                sourceId &&
                  sourceId !==
                    [...product.diyRuns].sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
                        b.id.localeCompare(a.id),
                    )[0]?.id
                  ? product
                  : draft,
                pricing.value.price,
              )}
            />
          </>
        )}
      </Drawer>
      {adjustOpen && product && (
        <StockAdjustmentDrawer
          name={product.name}
          resourceUrl={`/api/products/${product.id}`}
          onClose={() => setAdjustOpen(false)}
          onSaved={refreshProduct}
        />
      )}
      {materialPreview.viewer}
    </section>
  );
}
