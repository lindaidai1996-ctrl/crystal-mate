'use client';

import { type ComponentProps } from 'react';
import { Alert, Checkbox, Collapse, Form, Select, Space, Tag } from 'antd';
import { useTranslations } from 'next-intl';
import type {
  MaterialCategory,
  MaterialSaleRule,
  MaterialValues,
  Tag as MaterialTag,
} from '@/lib/client-types';
import { editMaterial, recalculateMaterial } from '@/lib/material-calculations';
import { calculatePurchase, emptyPurchase, type MaterialPurchase } from '@/lib/material-purchase';
import { MaterialBasicFields } from '@/components/materialManagement/materialBasicFields';
import {
  MaterialDetailFields,
  type MaterialDetailSection,
} from '@/components/materialManagement/materialDetailFields';
import { importMaterialDraft, importQuantity } from '@/lib/materialImageImport/materialDraft';
import type {
  ImportItem,
  ImportItemData,
  ImportMaterialDraft,
} from '@/lib/materialImageImport/contracts';
import { CropPreview } from './importImageCanvas';
import { ExistingMaterialSelect } from './existingMaterialSelect';
import { normalizeAliases } from '@/lib/catalog-aliases';
import importStyles from './materialImageImport.module.css';

export function ImportItemEditor({
  item,
  sourceUrl,
  sourceRatio,
  categories,
  tags,
  onTagCreated,
  onCategoryCreated,
  disabled,
  onChange,
  onUploadingChange,
}: {
  item: ImportItem;
  sourceUrl: string;
  sourceRatio: number;
  categories: MaterialCategory[];
  tags: MaterialTag[];
  onTagCreated: (tag: MaterialTag) => void;
  onCategoryCreated: (category: MaterialCategory) => void;
  disabled: boolean;
  onChange: (patch: Partial<ImportItemData>) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations('imageImport');
  const data = item.data;
  const locked = disabled || !!item.entryId;
  const material = importMaterialDraft(data);
  const quantity = importQuantity(data, material);
  const result = calculatePurchase(material.values, material.purchase, quantity);
  const values = result.values;

  function update(next: ImportMaterialDraft, nextQuantity = data.quantity) {
    onChange({
      material: next,
      name: next.values.name,
      categoryId: next.values.categoryId,
      unit: next.values.unit,
      quantity: nextQuantity,
    });
  }

  function change(field: keyof MaterialValues, value: string | number | null) {
    if (field === 'unit' && value !== values.unit) {
      const gramChanged = value === 'GRAM' || values.unit === 'GRAM';
      const nextValues = editMaterial(values, field, value);
      update(
        {
          ...material,
          values: gramChanged
            ? recalculateMaterial({
                ...nextValues,
                purchaseUnitPrice: null,
                weightGrams: null,
                purchaseGramPrice: null,
                purchaseGramManual: false,
                saleUnitPrice: null,
                saleGramPrice: null,
                saleUnitManual: false,
                saleGramManual: false,
              })
            : nextValues,
          purchase: gramChanged
            ? { ...emptyPurchase(), mode: value === 'GRAM' ? 'BATCH' : 'UNIT' }
            : material.purchase,
          quantityUnknown: false,
        },
        null,
      );
      return;
    }
    update({ ...material, values: editMaterial(values, field, value) });
  }

  function changeMode(mode: MaterialPurchase['mode']) {
    if (mode === material.purchase.mode) return;
    if (mode === 'BATCH') {
      update({
        ...material,
        values,
        purchase: {
          ...material.purchase,
          mode,
          unitInputs: {
            price: values.purchaseUnitPrice,
            weight: values.weightGrams,
            gramPrice: values.purchaseGramPrice,
            gramManual: values.purchaseGramManual,
          },
        },
      });
    } else {
      const saved = material.purchase.unitInputs;
      update({
        ...material,
        values: {
          ...values,
          purchaseUnitPrice: saved?.price ?? null,
          weightGrams: saved?.weight ?? null,
          purchaseGramPrice: saved?.gramPrice ?? null,
          purchaseGramManual: saved?.gramManual ?? false,
        },
        purchase: { ...material.purchase, mode },
      });
    }
  }

  function changeRule(rule: MaterialSaleRule) {
    update({
      ...material,
      values: recalculateMaterial(
        {
          ...values,
          saleRule: rule,
          saleRuleValue:
            rule === 'FIXED_AMOUNT' || rule === 'CUSTOM_PERCENT'
              ? (material.values.saleRuleValue ?? '0.00')
              : null,
        },
        true,
      ),
    });
  }

  const detailProps: ComponentProps<typeof MaterialDetailFields> = {
    values,
    purchase: material.purchase,
    quantity: data.quantity,
    quantityUnknown: material.quantityUnknown,
    onQuantityChange: (quantity) => update(material, quantity),
    onUnknownChange: (quantityUnknown) => update({ ...material, quantityUnknown }),
    onPurchaseChange: (purchase) => update({ ...material, purchase }),
    onModeChange: changeMode,
    onChange: change,
    onRuleChange: changeRule,
    onValuesChange: (values) => update({ ...material, values }),
    images: material.images,
    onImagesChange: (images) => update({ ...material, images }),
    onUploadingChange,
    disabled: locked,
    showNotes: !data.existingMaterialId,
    maxImages: 11,
    imagesExtra: (
      <div className={importStyles.cropAttachment}>
        <CropPreview
          sourceRatio={sourceRatio}
          url={sourceUrl}
          box={data.objectBox}
          label={t('thumbnail')}
          size={80}
        />
        <p className={importStyles.hint}>{t('cropAttachmentHelp')}</p>
      </div>
    ),
  };
  const detailGroups: { key: string; label: string; sections: MaterialDetailSection[] }[] = [
    { key: 'sale', label: t('saleConfiguration'), sections: ['strand', 'sale'] },
    { key: 'images', label: t('imageConfiguration'), sections: ['images', 'notes'] },
  ];

  return (
    <div className={importStyles.itemEditor}>
      {item.entryId && <Alert type="success" showIcon message={t('imported')} />}
      {!!data.warnings.length && (
        <Alert
          type="warning"
          showIcon
          message={t('checkRequired')}
          description={data.warnings.join('；')}
        />
      )}
      <Form layout="vertical" disabled={locked}>
        <div className={importStyles.reviewOverview}>
          <div className={importStyles.previews}>
            <div>
              <span>{t('thumbnail')}</span>
              <CropPreview
                sourceRatio={sourceRatio}
                url={sourceUrl}
                box={data.objectBox}
                label={t('thumbnail')}
                size={80}
                preview
              />
            </div>
            <div>
              <span>{t('priceEvidence')}</span>
              {data.priceBox ? (
                <CropPreview
                  sourceRatio={sourceRatio}
                  url={sourceUrl}
                  box={data.priceBox}
                  label={t('priceEvidence')}
                  size={100}
                  preview
                />
              ) : (
                <p className={importStyles.hint}>{t('noPriceBox')}</p>
              )}
              <Tag>{data.priceText || '—'}</Tag>
            </div>
          </div>
          <div className={importStyles.priceMeaning}>
            <Form.Item label={t('priceKind')}>
              <Select
                value={data.priceKind}
                options={[
                  { value: 'PURCHASE', label: t('purchase') },
                  { value: 'SALE', label: t('sale') },
                ]}
                onChange={(priceKind) => onChange({ priceKind, reviewed: false })}
              />
            </Form.Item>
            <p className={importStyles.hint}>
              {t('prefillHelp', { price: data.priceText || '—' })}
            </p>
          </div>
        </div>
        <Collapse
          ghost
          size="small"
          defaultActiveKey={data.existingMaterialId ? ['existing'] : []}
          items={[
            {
              key: 'existing',
              label: data.existingMaterialId
                ? `${t('existingMaterial')} · ${data.name}`
                : t('existingMaterial'),
              children: (
                <ExistingMaterialSelect
                  value={data.existingMaterialId}
                  name={data.name}
                  disabled={locked}
                  onChange={(match) => {
                    if (!match) {
                      onChange({ existingMaterialId: null, reviewed: false });
                      return;
                    }
                    // Identity comes from the existing material; recognized purchase/sale data stays in the new entry.
                    const unitChanged = values.unit !== match.unit;
                    const next = {
                      ...material,
                      values: recalculateMaterial({
                        ...values,
                        name: match.name,
                        aliases: normalizeAliases([...(match.aliases ?? []), ...values.aliases]),
                        categoryId: match.categoryId,
                        unit: match.unit,
                        notes: match.notes,
                        ...(unitChanged
                          ? {
                              purchaseUnitPrice: null,
                              purchaseGramPrice: null,
                              purchaseGramManual: false,
                              weightGrams: null,
                              saleUnitPrice: null,
                              saleGramPrice: null,
                              saleUnitManual: false,
                              saleGramManual: false,
                            }
                          : {}),
                      }),
                      tagIds: match.tags.map((tag) => tag.id),
                      purchase: unitChanged
                        ? {
                            ...emptyPurchase(),
                            mode: match.unit === 'GRAM' ? ('BATCH' as const) : ('UNIT' as const),
                          }
                        : material.purchase,
                    };
                    onChange({
                      existingMaterialId: match.id,
                      material: next,
                      name: match.name,
                      categoryId: match.categoryId,
                      unit: match.unit,
                      quantity: unitChanged ? null : data.quantity,
                      reviewed: false,
                    });
                  }}
                />
              ),
            },
          ]}
        />
        <div className="editor-surface material-editor">
          <MaterialBasicFields
            values={values}
            categories={categories}
            tags={tags}
            tagIds={material.tagIds}
            onTagsChange={(tagIds) => update({ ...material, tagIds })}
            onTagCreated={onTagCreated}
            onCategoryCreated={onCategoryCreated}
            onNameRecognized={(categoryId, tagIds) =>
              update({
                ...material,
                tagIds,
                values: { ...values, categoryId: categoryId ?? values.categoryId },
              })
            }
            onChange={change}
            onValuesChange={detailProps.onValuesChange}
            allowAliasEditing
            onAliasesChange={(aliases) => update({ ...material, values: { ...values, aliases } })}
            isAddingEntry={!!data.existingMaterialId}
            unitLocked={!!data.existingMaterialId}
          />
          {data.existingMaterialId && (
            <p className={importStyles.hint}>{t('existingAliasesHelp')}</p>
          )}
          <MaterialDetailFields {...detailProps} sections={['purchase']} />
          <Collapse
            ghost
            items={detailGroups.map((group) => ({
              key: group.key,
              label: group.label,
              children: <MaterialDetailFields {...detailProps} sections={group.sections} />,
            }))}
          />
        </div>
        <Space direction="vertical" className={importStyles.reviewChecks}>
          <Checkbox
            checked={data.selected}
            onChange={(event) => onChange({ selected: event.target.checked })}
          >
            {t('include')}
          </Checkbox>
          <Checkbox
            checked={data.reviewed}
            onChange={(event) => onChange({ reviewed: event.target.checked })}
          >
            {t('reviewed')}
          </Checkbox>
        </Space>
      </Form>
    </div>
  );
}
