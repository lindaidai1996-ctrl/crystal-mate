// In the signed-in admin site's browser console:
// const { importProductTags } = await import('/scripts/import-product-tags.mjs');
// await importProductTags();
// Pass an array to importProductTags([...]) to use other names next time.

export const sampleProductTags = [
  '橘幽灵',
  '黄幽灵',
  '粉幽灵',
  '白兔毛',
  '红兔毛',
  '粉兔毛',
  '蓝兔毛',
  '幻彩兔毛',
  '晶中晶',
  '晶中晶共生兔毛',
  '晶中晶共生黄泥矿',
  '铜矿',
  '黄铜矿',
  '方解石',
  '方解石共生铜矿',
  '骸骨',
  '黄泥矿',
  '白泥矿',
  '泥矿',
  '共生',
  '负晶',
  '水胆',
  '粉水晶',
  '紫水晶',
  '雪霜发',
  '蓝线',
  '碧玺',
  '黑银钛',
  '胶花',
  '粉胶花',
  '黄胶花',
  '红胶花',
  '牛血红胶花',
  '白胶花',
  '小树胶花',
  '云母',
  '粉云母',
  '橘云母',
  '橘黄云母',
  '异象云母',
  '云母片',
  '云母沙',
  '粉云母沙',
  '灰蓝云母',
  '蓝云母',
  '蓝金沙',
  '绿星沙',
  '粉星沙',
  '紫海胆',
  '黑铁矿',
  '蓝矿',
  '紫超七',
  '超七',
  '黑毒液',
];

export async function importProductTags(names = sampleProductTags) {
  if (!Array.isArray(names)) {
    throw new TypeError('Tag names must be an array.');
  }

  const normalizedNames = names.map((name) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
      throw new TypeError('Each tag name must contain 1 to 60 characters.');
    }
    return name.trim();
  });
  const uniqueNames = [...new Set(normalizedNames)];

  async function request(method, body) {
    const response = await fetch('/api/tags', {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.error ?? `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const existingTags = await request('GET');
  if (!Array.isArray(existingTags)) {
    throw new Error('The tag API returned an unexpected response.');
  }

  const existingNames = new Set(existingTags.map((tag) => tag.name));
  const result = { created: [], skipped: [], failed: [] };

  for (const name of uniqueNames) {
    if (existingNames.has(name)) {
      result.skipped.push(name);
      continue;
    }

    try {
      await request('POST', { name });
      result.created.push(name);
    } catch (error) {
      if (error.status === 409 && error.message === 'DUPLICATE') {
        result.skipped.push(name);
      } else {
        result.failed.push({ name, error: error.message });
      }
    }
  }

  console.info('Product tags import:', result);
  return result;
}
