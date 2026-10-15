import { DeleteOutlined, PlusOutlined, RedoOutlined } from '@ant-design/icons';
import { Button, Input, InputNumber, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import {
  hasCostInput,
  normalizeCostAmount,
  recalculateCabochonCost,
  withCostDetails,
  type CabochonCostValues,
} from '@/lib/cabochon-cost';

const emptyCost: CabochonCostValues = {
  roughStoneCost: null,
  settingCost: null,
  otherCosts: [],
  totalCost: null,
  totalManual: false,
};

function CostAmount({
  value,
  onChange,
  onBlur,
  label,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  onBlur: () => void;
  label: string;
}) {
  return (
    <InputNumber<string>
      stringMode
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      min="0"
      max="9999999999.99"
      step="0.01"
      precision={2}
      suffix="¥"
      aria-label={label}
      style={{ width: '100%' }}
    />
  );
}

export function CabochonCostFields({
  value,
  onChange,
}: {
  value?: CabochonCostValues | null;
  onChange?: (value: CabochonCostValues | null) => void;
}) {
  const t = useTranslations('editor');
  const cost = value ?? emptyCost;

  function emit(next: CabochonCostValues) {
    const updated = withCostDetails(next);
    onChange?.(hasCostInput(updated) ? updated : null);
  }

  function changeBase(field: 'roughStoneCost' | 'settingCost', amount: string | null) {
    emit({ ...cost, [field]: amount });
  }

  function changeOther(index: number, field: 'name' | 'amount', fieldValue: string | null) {
    const otherCosts = cost.otherCosts.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: fieldValue } : item,
    );
    emit({ ...cost, otherCosts });
  }

  function changeTotal(amount: string | null) {
    if (amount === null) {
      const updated = recalculateCabochonCost(cost);
      onChange?.(hasCostInput(updated) ? updated : null);
      return;
    }
    onChange?.({ ...cost, totalCost: amount, totalManual: true });
  }

  return (
    <div className="cabochon-cost-fields">
      <div className="cabochon-cost-base">
        {(['roughStoneCost', 'settingCost'] as const).map((field) => (
          <div key={field} className="cabochon-cost-field">
            <label>{t(field)}</label>
            <CostAmount
              value={cost[field]}
              onChange={(amount) => changeBase(field, amount)}
              onBlur={() => changeBase(field, normalizeCostAmount(cost[field]))}
              label={t(field)}
            />
          </div>
        ))}
      </div>
      <div className="cabochon-cost-other-heading">
        <h3>{t('otherCosts')}</h3>
        <Button
          icon={<PlusOutlined />}
          onClick={() =>
            emit({ ...cost, otherCosts: [...cost.otherCosts, { name: '', amount: null }] })
          }
          disabled={cost.otherCosts.length >= 50}
        >
          {t('addOtherCost')}
        </Button>
      </div>
      <div className="cabochon-cost-other-list">
        {cost.otherCosts.map((item, index) => (
          <div className="cabochon-cost-other-row" key={index}>
            <Input
              value={item.name}
              onChange={(event) => changeOther(index, 'name', event.target.value)}
              maxLength={60}
              placeholder={t('otherCostName')}
              aria-label={`${t('otherCostName')} ${index + 1}`}
            />
            <CostAmount
              value={item.amount}
              onChange={(amount) => changeOther(index, 'amount', amount)}
              onBlur={() => changeOther(index, 'amount', normalizeCostAmount(item.amount))}
              label={`${t('otherCostAmount')} ${index + 1}`}
            />
            <Tooltip title={t('removeOtherCost')}>
              <Button
                icon={<DeleteOutlined />}
                aria-label={`${t('removeOtherCost')} ${index + 1}`}
                onClick={() =>
                  emit({
                    ...cost,
                    otherCosts: cost.otherCosts.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              />
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="cabochon-cost-total">
        <div className="cabochon-cost-field">
          <label>{t('totalCost')}</label>
          <CostAmount
            value={cost.totalCost}
            onChange={changeTotal}
            onBlur={() => {
              if (cost.totalManual) changeTotal(normalizeCostAmount(cost.totalCost));
            }}
            label={t('totalCost')}
          />
        </div>
        <Button
          icon={<RedoOutlined />}
          onClick={() => {
            const updated = recalculateCabochonCost(cost);
            onChange?.(hasCostInput(updated) ? updated : null);
          }}
          disabled={!cost.totalManual}
        >
          {t('recalculateCost')}
        </Button>
      </div>
    </div>
  );
}
