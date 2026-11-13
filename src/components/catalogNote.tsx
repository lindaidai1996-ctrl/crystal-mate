'use client';

import { Popover } from 'antd';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import noteStyles from './catalogNote.module.css';

export function CatalogNote({ text }: { text: string }) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const content = text.trim();

  if (!content) return null;

  return (
    <Popover
      title={t('notes')}
      content={<div className={noteStyles.content}>{content}</div>}
      trigger={['hover', 'click']}
      open={open}
      onOpenChange={setOpen}
    >
      <button
        type="button"
        className={noteStyles.preview}
        aria-label={t('viewNotes')}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {t('notesPreview', { text: content.replace(/\s+/g, ' ') })}
      </button>
    </Popover>
  );
}
