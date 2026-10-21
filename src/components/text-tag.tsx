'use client';

import { Tag } from 'antd';
import { getTagAppearance } from '@/lib/tag-appearance';

export function TextTag({ text }: { text: string }) {
  return <Tag {...getTagAppearance(text)}>{text}</Tag>;
}
