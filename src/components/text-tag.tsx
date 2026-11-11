'use client';

import { Tag } from 'antd';
import { getTagAppearance } from '@/lib/tag-appearance';
import tagStyles from './textTag.module.css';

export function TextTag({ text }: { text: string }) {
  return (
    <Tag className={tagStyles.tag} title={text} {...getTagAppearance(text)}>
      {text}
    </Tag>
  );
}
