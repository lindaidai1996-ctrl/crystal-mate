<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Formatting

- Format every created or modified source file with Prettier before finishing a change.
- Run `npm run format:check` after edits. Use `npm run format` only when intentionally formatting the whole repository.
- Keep manual edits readable when Prettier cannot wrap a long expression or string.

## Testing

- 尽量不要新增或运行 E2E 测试，仅在改动较为复杂、确实需要验证完整流程时使用。简单的局部改动优先采用必要的格式、类型和 lint 检查。

## AI 助手同步维护

- 开发涉及商品、物料、分类/标签、渠道商、采购、库存、金额/单位、权限/隐私或数据部署方式的功能时，先按 [AI 助手扩充与同步维护指南](docs/plans/ai-assistant/maintenance.md) 判断影响。
- 普通新增业务记录不要求修改助手代码；字段、关系、业务口径、枚举、权限或查询能力变化时，检查助手契约、查询、汇总、语义规则及相关验证是否需要同步，不能假定页面改完助手就自动支持。
- 在对应功能的交付或交接中写明“AI 助手影响：无需同步 / 已同步 / 待同步”、原因与验证边界；待同步时列出缺口及后续任务。尚未实现的助手能力以执行计划为准，不描述为已支持。
