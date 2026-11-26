'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, Drawer, Empty, Input, InputNumber } from 'antd';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Sensitive, usePrivacyMode } from '@/components/privacyMode';
import { apiFetch, ClientApiError } from '@/lib/client-api';
import {
  commonFeeChoices,
  diyCommonFeesSchema,
  toggleCommonFee,
  type DiyCommonFee,
  type DiyExtraCost,
} from '@/lib/diy-common-fees';
import commonFeeStyles from './commonFeeFields.module.css';

const resourceUrl = '/api/settings/diy-common-fees';

export function CommonFeeFields({
  value,
  onChange,
}: {
  value: DiyExtraCost[];
  onChange: (value: DiyExtraCost[]) => void;
}) {
  const t = useTranslations('productSources');
  const common = useTranslations('common');
  const privacyMode = usePrivacyMode();
  const { message } = App.useApp();
  const [presets, setPresets] = useState<DiyCommonFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<DiyCommonFee[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<DiyCommonFee[]>(resourceUrl, { signal: controller.signal })
      .then((fees) => {
        if (controller.signal.aborted) return;
        setPresets(fees);
        setLoadError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  function changeFee(index: number, fields: Partial<DiyExtraCost>) {
    onChange(value.map((cost, at) => (at === index ? { ...cost, ...fields } : cost)));
  }

  function changePreset(id: string, fields: Partial<DiyCommonFee>) {
    setDraft(
      (current) => current?.map((fee) => (fee.id === id ? { ...fee, ...fields } : fee)) ?? null,
    );
    setSaveError(null);
  }

  async function save() {
    if (!draft || saving) return;
    const parsed = diyCommonFeesSchema.safeParse(draft);
    if (!parsed.success) {
      setSaveError(t('commonFeesInvalid'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const fees = await apiFetch<DiyCommonFee[]>(resourceUrl, {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      setPresets(fees);
      setDraft(null);
      message.success(common('saved'));
    } catch (error) {
      setSaveError(
        common(`errors.${error instanceof ClientApiError ? error.code : 'SERVER_ERROR'}` as never),
      );
    } finally {
      setSaving(false);
    }
  }

  const choices = commonFeeChoices(presets, value).filter(
    (fee) => !value.some((cost) => cost.commonFeeId === fee.id),
  );

  return (
    <section className={commonFeeStyles.section} aria-label={t('extraCosts')}>
      <div className={commonFeeStyles.header}>
        <strong>{t('extraCosts')}</strong>
        <Button
          type="link"
          size="small"
          disabled={loading || loadError}
          onClick={() => {
            setDraft(presets.map((fee) => ({ ...fee })));
            setSaveError(null);
          }}
        >
          {t('manageCommonFeesTitle')}
        </Button>
      </div>
      <div className={commonFeeStyles.choices}>
        {choices.map((fee) => (
          <Button
            key={fee.id}
            size="small"
            icon={<PlusOutlined />}
            disabled={loading || loadError || value.length >= 50}
            onClick={() => onChange(toggleCommonFee(value, fee, true))}
          >
            {fee.name}
          </Button>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={value.length >= 50}
          onClick={() =>
            onChange([...value, { name: '', quantity: 1, amount: '', quoteAmount: null }])
          }
        >
          {t('addCustomFee')}
        </Button>
      </div>
      {loading && <span className={commonFeeStyles.hint}>{common('loading')}</span>}
      {loadError && (
        <div className={commonFeeStyles.error}>
          <span>{t('commonFeesLoadError')}</span>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              setRevision((current) => current + 1);
            }}
          >
            {common('retry')}
          </Button>
        </div>
      )}
      {value.length > 0 ? (
        <div className={`${commonFeeStyles.fees} ${privacyMode ? commonFeeStyles.private : ''}`}>
          <div className={commonFeeStyles.columns} aria-hidden="true">
            <span>{t('costName')}</span>
            <span>{t('feeQuantity')}</span>
            <Sensitive>
              <span>{t('feeUnitCost')}</span>
            </Sensitive>
            <span>{t('feeUnitQuote')}</span>
            <span />
          </div>
          {value.map((fee, index) => (
            <div className={commonFeeStyles.feeRow} key={fee.commonFeeId ?? `custom-${index}`}>
              <label className={commonFeeStyles.feeName}>
                <span className={commonFeeStyles.mobileLabel}>{t('costName')}</span>
                <Input
                  maxLength={60}
                  value={fee.name}
                  onChange={(event) => changeFee(index, { name: event.target.value })}
                />
              </label>
              <label className={`${commonFeeStyles.amount} ${commonFeeStyles.quantity}`}>
                <span className={commonFeeStyles.mobileLabel}>{t('feeQuantity')}</span>
                <InputNumber
                  min={1}
                  max={2147483647}
                  precision={0}
                  value={fee.quantity === 0 ? null : (fee.quantity ?? 1)}
                  onChange={(quantity) => changeFee(index, { quantity: quantity ?? 0 })}
                />
              </label>
              <Sensitive>
                <label className={`${commonFeeStyles.amount} ${commonFeeStyles.cost}`}>
                  <span className={commonFeeStyles.mobileLabel}>{t('feeUnitCost')}</span>
                  <InputNumber<string>
                    stringMode
                    min="0"
                    max="9999999999.99"
                    precision={2}
                    value={fee.amount === '' ? null : fee.amount}
                    onChange={(amount) => changeFee(index, { amount: amount ?? '' })}
                  />
                </label>
              </Sensitive>
              <label className={`${commonFeeStyles.amount} ${commonFeeStyles.quote}`}>
                <span className={commonFeeStyles.mobileLabel}>{t('feeUnitQuote')}</span>
                <InputNumber<string>
                  stringMode
                  min="0"
                  max="9999999999.99"
                  precision={2}
                  value={fee.quoteAmount ?? null}
                  placeholder={t('quoteMissing')}
                  onChange={(quoteAmount) => changeFee(index, { quoteAmount })}
                />
              </label>
              <Button
                className={commonFeeStyles.remove}
                danger
                icon={<DeleteOutlined />}
                aria-label={`${t('removeExtra')} ${fee.name}`}
                title={t('removeExtra')}
                onClick={() => onChange(value.filter((_, at) => at !== index))}
              />
            </div>
          ))}
        </div>
      ) : (
        <span className={commonFeeStyles.hint}>{t('extraCostsEmpty')}</span>
      )}
      {value.length > 0 && <p className={commonFeeStyles.hint}>{t('feeQuantityHelp')}</p>}
      <Drawer
        title={t('manageCommonFeesTitle')}
        open={draft !== null}
        width="min(560px, 100vw)"
        onClose={() => setDraft(null)}
        closable={!saving}
        maskClosable={!saving}
        keyboard={!saving}
        extra={
          <Button type="primary" loading={saving} onClick={() => void save()}>
            {common('save')}
          </Button>
        }
      >
        <div className={commonFeeStyles.editor}>
          <p className={commonFeeStyles.hint}>{t('commonFeesManageHelp')}</p>
          {saveError && <Alert type="error" showIcon message={saveError} />}
          {draft?.length === 0 && <Empty description={t('commonFeesEmpty')} />}
          {draft?.map((fee) => (
            <div className={commonFeeStyles.editorRow} key={fee.id}>
              <label className={commonFeeStyles.name}>
                <span>{t('costName')}</span>
                <Input
                  maxLength={60}
                  value={fee.name}
                  disabled={saving}
                  onChange={(event) => changePreset(fee.id, { name: event.target.value })}
                />
              </label>
              <Sensitive>
                <label className={commonFeeStyles.defaultAmount}>
                  <span>{t('commonFeeDefaultCost')}</span>
                  <InputNumber<string>
                    stringMode
                    prefix="¥"
                    min="0"
                    max="9999999999.99"
                    precision={2}
                    value={fee.amount || null}
                    disabled={saving}
                    onChange={(amount) => changePreset(fee.id, { amount: amount ?? '' })}
                  />
                </label>
              </Sensitive>
              <label className={commonFeeStyles.defaultAmount}>
                <span>{t('commonFeeDefaultQuote')}</span>
                <InputNumber<string>
                  stringMode
                  prefix="¥"
                  min="0"
                  max="9999999999.99"
                  precision={2}
                  value={fee.quoteAmount || null}
                  disabled={saving}
                  onChange={(quoteAmount) =>
                    changePreset(fee.id, { quoteAmount: quoteAmount ?? '' })
                  }
                />
              </label>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`${common('delete')} ${fee.name}`}
                disabled={saving}
                onClick={() => {
                  setDraft((current) => current?.filter((item) => item.id !== fee.id) ?? null);
                  setSaveError(null);
                }}
              />
            </div>
          ))}
          <Button
            icon={<PlusOutlined />}
            disabled={saving || (draft?.length ?? 0) >= 50}
            onClick={() => {
              setDraft((current) => [
                ...(current ?? []),
                { id: crypto.randomUUID(), name: '', amount: '0', quoteAmount: '0' },
              ]);
              setSaveError(null);
            }}
          >
            {t('addCommonFee')}
          </Button>
        </div>
      </Drawer>
    </section>
  );
}
