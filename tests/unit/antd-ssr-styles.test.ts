import { createCache, extractStyle, StyleProvider } from '@ant-design/cssinjs';
import { Button, ConfigProvider, Input, Layout, Menu, Select, Table } from 'antd';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';

it('collects component styles and theme variables during server rendering', () => {
  const cache = createCache();
  const content = createElement(
    Layout,
    null,
    createElement(Menu, { items: [{ key: 'materials', label: 'Materials' }] }),
    createElement(Input),
    createElement(Select, { options: [] }),
    createElement(Button, { type: 'primary' }, 'Save'),
    createElement(Table, {
      columns: [{ title: 'Name', dataIndex: 'name' }],
      dataSource: [],
      pagination: false,
    }),
  );

  renderToString(
    createElement(
      StyleProvider,
      { cache, layer: true },
      createElement(ConfigProvider, { theme: { cssVar: { key: 'crystal-mate' } } }, content),
    ),
  );

  // Use the same extraction options as AntdRegistry. A second cssinjs instance
  // leaves this cache empty even though Ant Design renders component markup.
  const css = extractStyle(cache, { plain: true, once: true });

  for (const component of ['layout', 'menu', 'input', 'select', 'btn', 'table']) {
    expect(css).toContain(`.ant-${component}`);
  }
  expect(css.includes('.crystal-mate{')).toBe(true);
  expect(/--ant-color-primary:[^;]+;/.test(css)).toBe(true);
  expect(css.includes('@layer antd{')).toBe(true);
});
