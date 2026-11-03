'use client';

import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Input,
  Select,
  Space,
  Tag,
} from 'antd';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/client-api';
import { excelFields, type ExcelRowInput } from '@/lib/cabochonExcelImport/contracts';
import {
  excelTagSource,
  normalizeExcelRow,
  type MatchItem,
} from '@/lib/cabochonExcelImport/normalize';
import { useNameTagRecognition } from '@/components/productEditor/useNameTagRecognition';
import { NameTagControls } from '@/components/productEditor/nameTagControls';
import layout from './excelImport.module.css';
import { SettingStyleField } from './settingStyleField';
import { sourceStyle } from '@/lib/cabochonExcelImport/styleReview';

export function ExcelRowEditor({
  row,
  tags,
  styles,
  busy,
  onClose,
  onSave,
  onTagCreated,
  sameStyleCount,
  createdStyleIds,
}: {
  row: ExcelRowInput;
  tags: MatchItem[];
  styles: { id: string; magicBoxStyle: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (row: ExcelRowInput, applySameStyle: boolean) => Promise<void>;
  onTagCreated: (tag: MatchItem) => void;
  sameStyleCount: number;
  createdStyleIds: Set<string>;
}) {
  const t = useTranslations('cabochonExcel');
  const { message } = App.useApp();
  const [draft, setDraft] = useState<ExcelRowInput>({ ...row, sourceStyle: sourceStyle(row) });
  const [newTag, setNewTag] = useState(row.values.type.trim());
  const [creating, setCreating] = useState(false);
  const [applySameStyle, setApplySameStyle] = useState(false);
  const normalized = normalizeExcelRow(draft, tags, styles);
  const nameTags = useNameTagRecognition({
    readName: () => excelTagSource(draft),
    readTags: () => (draft.tagChoice === 'SELECT' ? normalized.tagIds : []),
    writeTags: (ids, match, name) =>
      setDraft((current) => ({
        ...current,
        tagChoice: current.tagChoice === 'SELECT' ? 'SELECT' : 'AUTO',
        tagIds: current.tagChoice === 'SELECT' ? ids : current.tagIds,
        tagMatch: { ...match, source: name },
      })),
  });
  return (
    <Drawer
      open
      title={t('editRow', { row: row.rowNumber })}
      size="large"
      onClose={() => {
        if (!busy && !creating && !nameTags.matching) onClose();
      }}
      keyboard={!busy && !creating && !nameTags.matching}
      closable={!busy && !creating && !nameTags.matching}
      maskClosable={!busy && !creating && !nameTags.matching}
      extra={
        <Button
          type="primary"
          loading={busy}
          disabled={creating || nameTags.matching}
          onClick={() => void onSave(draft, applySameStyle)}
        >
          {t('saveRow')}
        </Button>
      }
    >
      <Space direction="vertical" size="large" className={layout.fullWidth}>
        <Alert
          type={normalized.errors.length ? 'warning' : 'success'}
          message={normalized.name}
          description={
            <Space wrap>
              {[...normalized.errors, ...normalized.warnings].map((issue) => (
                <Tag key={issue}>{t(`issues.${issue}` as never)}</Tag>
              ))}
            </Space>
          }
        />
        <label className={layout.field}>
          <div className={layout.reviewHeading}>
            <span>{t('productName')}</span>
            <Button
              type="link"
              size="small"
              disabled={busy || draft.productName == null}
              onClick={() => {
                nameTags.invalidate();
                setDraft({ ...draft, productName: null });
              }}
            >
              {t('restoreAutoName')}
            </Button>
          </div>
          <Input
            aria-label={t('productName')}
            value={draft.productName ?? normalized.generatedName}
            maxLength={120}
            disabled={busy}
            status={normalized.errors.includes('NAME_REQUIRED') ? 'error' : undefined}
            onChange={(event) => {
              if (!draft.values.type.trim()) nameTags.invalidate();
              setDraft({ ...draft, productName: event.target.value });
            }}
            onBlur={() => {
              if (!draft.values.type.trim()) void nameTags.recognize();
            }}
          />
          <span className={layout.muted}>
            {t(draft.productName == null ? 'autoNameHelp' : 'manualNameHelp')}
          </span>
        </label>
        <SettingStyleField
          draft={draft}
          options={styles}
          busy={busy}
          sameCount={sameStyleCount}
          applySame={applySameStyle}
          onApplySame={setApplySameStyle}
          onChange={setDraft}
          createdStyleIds={createdStyleIds}
        />
        <div className={layout.editGrid}>
          {excelFields
            .filter((field) => field !== 'image' && field !== 'style')
            .map((field) => (
              <label key={field}>
                <span>{t(`fields.${field}`)}</span>
                {field === 'notes' || field === 'measurement' ? (
                  <Input.TextArea
                    aria-label={t(`fields.${field}`)}
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    disabled={busy}
                    value={draft.values[field]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        values: { ...draft.values, [field]: event.target.value },
                      })
                    }
                  />
                ) : (
                  <Input
                    aria-label={t(`fields.${field}`)}
                    disabled={busy}
                    value={draft.values[field]}
                    onBlur={() => {
                      if (field === 'type' && draft.tagChoice === 'AUTO') void nameTags.recognize();
                    }}
                    onChange={(event) => {
                      if (field === 'type') nameTags.invalidate();
                      setDraft({
                        ...draft,
                        values: { ...draft.values, [field]: event.target.value },
                      });
                    }}
                  />
                )}
              </label>
            ))}
        </div>
        <label className={layout.field}>
          <span>{t('tagHandling')}</span>
          <Select
            aria-label={t('tagHandling')}
            value={draft.tagChoice}
            disabled={busy || creating}
            showSearch
            optionFilterProp="label"
            options={[
              { value: 'AUTO', label: t('autoTag') },
              { value: 'NONE', label: t('noTag') },
              { value: 'SELECT', label: t('manualTags') },
            ]}
            onChange={(value: ExcelRowInput['tagChoice']) => {
              nameTags.reset();
              setDraft({
                ...draft,
                tagChoice: value,
                tagIds: normalized.tagIds,
                tagId: null,
              });
            }}
          />
        </label>
        {draft.tagChoice !== 'NONE' && (
          <>
            <Select
              mode="multiple"
              aria-label={t('manualTags')}
              value={normalized.tagIds}
              disabled={busy || creating}
              showSearch
              optionFilterProp="label"
              options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              onChange={(ids: string[]) => {
                nameTags.reset();
                setDraft({
                  ...draft,
                  tagChoice: ids.length ? 'SELECT' : 'NONE',
                  tagIds: ids,
                  tagId: null,
                });
              }}
            />
            <NameTagControls
              {...nameTags}
              missingTags={
                nameTags.missingTags.length ? nameTags.missingTags : normalized.missingTags
              }
              disabled={busy || creating || !excelTagSource(draft)}
              onRecognize={() => void nameTags.recognize(true)}
            />
          </>
        )}
        <Space.Compact className={layout.fullWidth}>
          <Input
            aria-label={t('newTag')}
            value={newTag}
            maxLength={60}
            onChange={(event) => setNewTag(event.target.value)}
            placeholder={t('newTag')}
            disabled={busy || creating}
          />
          <Button
            loading={creating}
            disabled={busy || nameTags.matching || !newTag.trim()}
            onClick={async () => {
              setCreating(true);
              try {
                const tag = await apiFetch<MatchItem>('/api/tags', {
                  method: 'POST',
                  body: JSON.stringify({ name: newTag.trim() }),
                });
                onTagCreated(tag);
                const ids = [...new Set([...normalized.tagIds, tag.id])];
                nameTags.reset();
                setDraft((current) => ({
                  ...current,
                  tagChoice: 'SELECT',
                  tagId: null,
                  tagIds: ids,
                }));
              } catch {
                message.error(t('tagCreateFailed'));
              } finally {
                setCreating(false);
              }
            }}
          >
            {t('createTag')}
          </Button>
        </Space.Compact>
        {draft.imageErrors.length > 0 && (
          <Alert
            type="warning"
            message={t('imageProblems', { count: draft.imageErrors.length })}
            description={
              <Checkbox
                checked={draft.ignoreImageErrors}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, ignoreImageErrors: event.target.checked })
                }
              >
                {t('ignoreImages')}
              </Checkbox>
            }
          />
        )}
        <Descriptions
          title={t('originalValues')}
          column={1}
          size="small"
          bordered
          items={draft.original.map((cell, index) => ({
            key: index,
            label: cell.column,
            children: cell.value || '—',
          }))}
        />
      </Space>
    </Drawer>
  );
}
