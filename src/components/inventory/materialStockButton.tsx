'use client';

import { Button, Popover, Space } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MaterialBatchEntry } from '@/lib/client-types';
import { StockAdjustmentDrawer } from './stockAdjustmentDrawer';
import inventoryStyles from './inventory.module.css';

type StockEntry = Pick<MaterialBatchEntry, 'id' | 'batch' | 'remainingQty'>;

export function MaterialStockButton({
  materialId,
  name,
  unit,
  entries,
  allowDecimals = false,
  onSaved,
}: {
  materialId: string;
  name: string;
  unit: string;
  entries: StockEntry[];
  allowDecimals?: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations('inventory');
  const [selected, setSelected] = useState<StockEntry | null>(null);
  const [choosing, setChoosing] = useState(false);
  const button = (
    <Button
      type="text"
      disabled={!entries.length}
      onClick={() => (entries.length === 1 ? setSelected(entries[0]) : setChoosing(true))}
    >
      {t('adjust')}
    </Button>
  );
  return (
    <>
      {entries.length > 1 ? (
        <Popover
          title={t('selectBatch')}
          trigger="click"
          open={choosing}
          onOpenChange={setChoosing}
          content={
            <Space direction="vertical" className={inventoryStyles.batchChoices}>
              {entries.map((entry) => (
                <Button
                  key={entry.id}
                  type="text"
                  className={inventoryStyles.batchChoice}
                  onClick={() => {
                    setChoosing(false);
                    setSelected(entry);
                  }}
                >
                  {entry.batch.name} · {entry.remainingQty ?? t('unknown')} {unit}
                </Button>
              ))}
            </Space>
          }
        >
          {button}
        </Popover>
      ) : (
        button
      )}
      {selected && (
        <StockAdjustmentDrawer
          key={selected.id}
          name={`${name} · ${selected.batch.name}`}
          unit={unit}
          allowDecimals={allowDecimals}
          resourceUrl={`/api/materials/${materialId}/batches/${selected.id}`}
          onClose={() => setSelected(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
