'use client';

import { CheckOutlined, CloseOutlined, EditOutlined, ScanOutlined } from '@ant-design/icons';
import { App, Button, Input, InputNumber, Popover, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { CabochonMeasurement, Product } from '@/lib/client-types';
import { parseMeasurement } from '@/lib/parse-measurement';
import styles from './productInlineEdit.module.css';

export type ProductQuickEditChange =
  | { field: 'price'; value: number }
  | { field: 'stock'; value: number }
  | { field: 'measurement'; value: CabochonMeasurement | null };

type EditableField = ProductQuickEditChange['field'];
const emptyMeasurement: CabochonMeasurement = {
  lengthMm: null,
  widthMm: null,
  heightMm: null,
};
const dimensionFields = ['lengthMm', 'widthMm', 'heightMm'] as const;

export function ProductInlineEdit({
  product,
  field,
  children,
  onSave,
}: {
  product: Product;
  field: EditableField;
  children: ReactNode;
  onSave: (change: ProductQuickEditChange) => Promise<void>;
}) {
  const common = useTranslations('common');
  const products = useTranslations('products');
  const editor = useTranslations('editor');
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [price, setPrice] = useState<number | null>(product.priceCents / 100);
  const [stock, setStock] = useState<number | null>(product.stock);
  const [measurement, setMeasurement] = useState<CabochonMeasurement>(
    product.measurement ?? emptyMeasurement,
  );
  const [recognitionInput, setRecognitionInput] = useState('');

  const label =
    field === 'price'
      ? products('price')
      : products(field === 'stock' ? 'stockQuantity' : 'dimensions');
  const validPrice =
    price !== null &&
    Number.isFinite(price) &&
    price >= 0 &&
    price <= 21474836.47 &&
    /^\d+(?:\.\d{1,2})?$/.test(String(price));
  const validStock = stock !== null && Number.isInteger(stock) && stock >= 0 && stock <= 2147483647;
  const validMeasurement = dimensionFields.every((key) => {
    const value = measurement[key];
    return (
      value === null ||
      (Number.isFinite(value) &&
        value > 0 &&
        value <= 99999999.99 &&
        /^\d+(?:\.\d{1,2})?$/.test(String(value)))
    );
  });
  const originalMeasurement = product.measurement ?? emptyMeasurement;
  const changed =
    field === 'price'
      ? price !== product.priceCents / 100
      : field === 'stock'
        ? stock !== product.stock
        : dimensionFields.some((key) => measurement[key] !== originalMeasurement[key]);
  const canSave =
    changed && (field === 'price' ? validPrice : field === 'stock' ? validStock : validMeasurement);

  function openEditor() {
    if (saving) return;
    setPrice(product.priceCents / 100);
    setStock(product.stock);
    setMeasurement(product.measurement ?? emptyMeasurement);
    setRecognitionInput('');
    setOpen(true);
  }

  function recognize() {
    const parsed = parseMeasurement(recognitionInput);
    if (!parsed) {
      message.error(editor('recognitionInvalid'));
      return;
    }
    setMeasurement(parsed);
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (field === 'price') {
        await onSave({ field, value: Math.round(price! * 100) });
      } else if (field === 'stock') {
        await onSave({ field, value: stock! });
      } else {
        const value = dimensionFields.every((key) => measurement[key] === null)
          ? null
          : measurement;
        await onSave({ field, value });
      }
      setOpen(false);
    } catch {
      // The list reports the API error and keeps the editor open for correction.
    } finally {
      setSaving(false);
    }
  }

  const content = (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={styles.title}>{label}</div>
      {field === 'price' && (
        <InputNumber
          autoFocus
          aria-label={label}
          value={price}
          onChange={setPrice}
          min={0}
          max={21474836.47}
          precision={2}
          step={0.01}
          prefix="¥"
          className={styles.fullWidth}
          disabled={saving}
        />
      )}
      {field === 'stock' && (
        <InputNumber
          autoFocus
          aria-label={label}
          value={stock}
          onChange={setStock}
          min={0}
          max={2147483647}
          precision={0}
          step={1}
          className={styles.fullWidth}
          disabled={saving}
        />
      )}
      {field === 'measurement' && (
        <>
          <div className={styles.dimensions}>
            {dimensionFields.map((key) => (
              <label key={key} className={styles.dimension}>
                <span>{editor(key)}</span>
                <InputNumber
                  aria-label={editor(key)}
                  value={measurement[key]}
                  onChange={(value) => setMeasurement((current) => ({ ...current, [key]: value }))}
                  min={0.01}
                  max={99999999.99}
                  precision={2}
                  step={0.01}
                  className={styles.fullWidth}
                  disabled={saving}
                />
              </label>
            ))}
          </div>
          <div className={styles.unit}>mm</div>
          <label className={styles.recognitionLabel} htmlFor={`recognition-${product.id}`}>
            {editor('smartRecognition')}
          </label>
          <div className={styles.recognition}>
            <Input
              id={`recognition-${product.id}`}
              value={recognitionInput}
              onChange={(event) => setRecognitionInput(event.target.value)}
              onPressEnter={(event) => {
                event.preventDefault();
                recognize();
              }}
              placeholder={editor('recognitionPlaceholder')}
              disabled={saving}
            />
            <Tooltip title={editor('recognize')}>
              <Button
                icon={<ScanOutlined />}
                aria-label={editor('recognize')}
                onClick={recognize}
                disabled={saving}
              />
            </Tooltip>
          </div>
        </>
      )}
      <div className={styles.actions}>
        <Tooltip title={common('cancel')}>
          <Button
            icon={<CloseOutlined />}
            aria-label={common('cancel')}
            onClick={() => setOpen(false)}
            disabled={saving}
          />
        </Tooltip>
        <Tooltip title={common('save')}>
          <Button
            type="primary"
            htmlType="submit"
            icon={<CheckOutlined />}
            aria-label={common('save')}
            disabled={!canSave}
            loading={saving}
          />
        </Tooltip>
      </div>
    </form>
  );

  return (
    <Popover
      content={content}
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) setOpen(false);
      }}
      trigger="click"
      placement="bottomLeft"
      destroyOnHidden
    >
      <span className={styles.cell} onDoubleClick={openEditor}>
        <span className={styles.value}>{children}</span>
        <Tooltip title={`${common('edit')} ${label}`}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={`${common('edit')} ${label}`}
            className={styles.editButton}
            onClick={openEditor}
          />
        </Tooltip>
      </span>
    </Popover>
  );
}
