import { z } from 'zod';

export type NamedTag = { id: string; name: string };
export const nameTagMatchSchema = z.object({
  tagIds: z.array(z.string().min(1).max(100)).max(100),
  missingTags: z.array(z.string().trim().min(1).max(60)).max(30),
});
export type NameTagMatch = z.infer<typeof nameTagMatchSchema>;
export const nameTagRequestSchema = z.strictObject({
  names: z.array(z.string().trim().min(1).max(10000)).min(1).max(20),
});
export const normalizeTagName = (name: string) => name.normalize('NFKC').trim().toLowerCase();

// Only expand an already identified compound tag; never attach a color to a nearby type.
const colorNames = [
  '粉红',
  '玫红',
  '橘红',
  '橙红',
  '紫红',
  '蓝绿',
  '黄绿',
  '粉',
  '红',
  '橙',
  '橘',
  '黄',
  '绿',
  '青',
  '蓝',
  '紫',
  '黑',
  '白',
  '灰',
  '棕',
  '褐',
  '金',
  '银',
];
const colorPrefix = new RegExp(`^(?:浅|深|淡|浓)?(?:${colorNames.join('|')})(?:色)?`);
export function expandColorTypeTags(match: NameTagMatch, tags: NamedTag[]): NameTagMatch {
  const ids = new Set(match.tagIds);
  const missing = new Set(match.missingTags);
  const byName = new Map(tags.map((tag) => [normalizeTagName(tag.name), tag]));
  for (const tag of tags.filter((tag) => ids.has(tag.id))) {
    const name = normalizeTagName(tag.name);
    const baseName = name.replace(colorPrefix, '');
    if (!baseName || baseName === name) continue;
    const base = byName.get(baseName);
    if (base) ids.add(base.id);
    else missing.add(baseName);
  }
  return {
    tagIds: [...ids],
    missingTags: [...missing].filter((name) => !byName.has(normalizeTagName(name))),
  };
}

export function replaceAutomaticTags(current: string[], previousAuto: string[], next: string[]) {
  const automatic = new Set(previousAuto);
  const manual = current.filter((id) => !automatic.has(id));
  return {
    tagIds: [...new Set([...manual, ...next])],
    automaticTagIds: next.filter((id) => !manual.includes(id)),
  };
}
