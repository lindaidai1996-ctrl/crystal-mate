'use client';

import { Select, Tooltip, type SelectProps } from 'antd';
import { useMemo } from 'react';
import type { Distributor } from '@/lib/client-types';
import distributorSelectStyles from './distributorSelect.module.css';

type DistributorChoice = Pick<Distributor, 'id' | 'name' | 'area' | 'notes'>;
type DistributorOption = {
  value: string;
  label: string;
  area: string;
  name: string;
  notes: string;
  title: string;
};
type DistributorSelectProps<ValueType> = Omit<
  SelectProps<ValueType, DistributorOption>,
  'options' | 'children' | 'optionRender' | 'optionFilterProp' | 'filterSort'
> & {
  distributors: readonly DistributorChoice[];
};

function DistributorLabel({ option }: { option: DistributorOption }) {
  return (
    <span className={distributorSelectStyles.label}>
      <span className={distributorSelectStyles.area}>{option.area}</span>
      <span className={distributorSelectStyles.name}>{option.name}</span>
      {option.notes && <span className={distributorSelectStyles.notes}>{option.notes}</span>}
    </span>
  );
}

export function DistributorSelect<ValueType extends string | string[] = string>({
  distributors,
  ...props
}: DistributorSelectProps<ValueType>) {
  const options = useMemo(() => {
    const collator = new Intl.Collator('zh-CN', { numeric: true });
    return [...distributors]
      .sort((a, b) => collator.compare(a.area, b.area) || collator.compare(a.name, b.name))
      .map((distributor) => {
        const notes = distributor.notes.trim();
        return {
          value: distributor.id,
          label: [distributor.area, distributor.name, notes].filter(Boolean).join(' · '),
          area: distributor.area,
          name: distributor.name,
          notes,
          title: '',
        };
      });
  }, [distributors]);

  return (
    <Select<ValueType, DistributorOption>
      showSearch
      {...props}
      optionFilterProp="label"
      options={options}
      labelRender={
        props.labelRender ??
        ((selected) => {
          const option = options.find((item) => item.value === selected.value);
          return option ? <DistributorLabel option={option} /> : selected.label;
        })
      }
      optionRender={({ data }) => (
        <Tooltip
          title={
            data.notes ? (
              <div className={distributorSelectStyles.fullNotes}>{data.notes}</div>
            ) : null
          }
          placement="topLeft"
          styles={{ root: { maxWidth: 'min(480px, calc(100vw - 32px))' } }}
          destroyOnHidden
        >
          <div className={distributorSelectStyles.option}>
            <DistributorLabel option={data} />
          </div>
        </Tooltip>
      )}
    />
  );
}
