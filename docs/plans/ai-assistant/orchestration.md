# P4 受控编排、持久会话与执行记录

2026-11-17。P4 应用内部服务已由 P5 认证 HTTP/界面消费，见[界面契约](interface.md)；没有语音。业务契约/语义规则仍为 v1，当前提示词为 orchestration-v5 / relevance-v3；历史报告保留各自执行时版本。

## 服务入口与权限

`conversation-service.ts` 的入口均先 `requireAccount(request)`，认证账号来自后端，不接受客户端/模型指定 ownerId、accountId、SQL、工具定义或候选。P4 核心入口：

- `createAssistantConversation(request)`：创建账号自己的会话。
- `readAssistantConversation(request, {conversationId})`：一致性事务读取会话、最新执行、最近 50 条消息；不存在/非本人同样拒绝。`interrupted/recovery` 明确标示租约过期，持久记录的原始 running 不伪改为成功。
- `commandAssistantConversation(request, input)`：严格联合 `message / continue / retry / cancel`，均含 conversationId、revision；message 另含 text（最多 4000 字符）。message/continue/retry 可提供受限 budget、relevanceBudget。所有写入用账号、会话、revision、执行 ID 与租约共同校验。

P5 新增认证 facade：`listAssistantConversations`、`readAssistantBrowserConversation` 与 `saveAssistantConversationFeedback`，命令复用 `commandAssistantConversation` 后重新读取投影。HTTP 仅调用这些入口及认证创建服务，维持方法/请求体限制、同源/审计、隐私投影与 STALE_REVISION 等安全码；没有公开低层 store/facts。新增助手反馈表独立保存 pending_review，不改变 P4 执行或全局规则。

## 受控工具协议

原生 fetch，非流式，后端强制指定单工具，`parallel_tool_calls=false`。不是 auto 工具代理：

1. `plan_query`：严格 Zod patch。后端确定当前时间和日期边界，校验最终 AssistantQuery。hard 未提供保留、null 删除；semantic 按概念整组替换，未提供保留、空数组删除；不从软语义生成硬标签。
2. `query_facts`：参数只能 `{}`。使用后端已校验条件，读取完整有界候选并运行 P3 判断，P2 重新读取/计算事实。采购选择只能来自后端 include 身份；显式空选择保留，不省略成不限范围。
3. `finish`：参数只能 `{}`；要求已有后端事实。模型不撰写最终金额/数量/库存/明细，返回结构化后端结果。模型仅看到条件及最小状态回执，不看到采购金额/库存。

澄清时停止查询，保存待澄清文本、pendingPlan 和上一条必要问题；后续消息带入该最小上下文。三种指定追问的条件保留/替换已用真实合成解析验证；一般自然语言仍受模型理解和 v1 业务范围限制，不声称所有问法正确。

业务字段、历史条件、名称/备注及工具回执都是数据。传输及持久化对常见 credential/URL/手机号/邮箱做最小化；相关性模型只看到必要语义 DTO，证据索引仍映射服务端原字段。不能将模式替换称为通用隐私识别；新增敏感字段仍需审核 DTO。

## 会话与进程边界

三张助手专用表：AssistantConversation 保存归属/生效条件/revision/活跃执行/租约，AssistantMessage 保存最小消息，AssistantExecution 保存每次执行、父执行引用和受控 DTO。迁移只新增这些表/索引/外键，不改业务记录或冻结基线。

P4 的候选/相关性运行对象仅活于单次服务调用，不向后续请求暴露内存游标。continue/retry 创建新执行，继承检查点和累计成本；重新读取完整有界候选并比较查询/来源 SHA-256 以及相关性提示词/模型/endpoint 配置指纹，完全一致且证据验证通过才复用判断；变化或持久化脱敏导致证据不一致时重新判断，成本不清零。金额/数量/库存始终重新读取。finish 阶段失败后重试也回到 query_facts，避免把旧事实当实时结果。

因此后续命令可在另一进程处理，无需粘性路由；现有 P2/P3 独立服务的 10 分钟内存运行仍保持原边界。不是将内存快照称为持久会话，也没有实现长期数据库候选快照或超过 5000 行的分块查询。

每会话最多一个活跃执行，150 秒租约，超过最大单次编排 120 秒。过期需显式 continue/retry 或新消息，不自动收费重试。成功抢占递增 revision；取消也递增 revision。每次保存/完成检查租约及当前执行，旧请求、旧进度回调和旧响应均无法覆盖新执行。取消已完成/无结果执行为 no-op，取消暂停执行会持久标记 cancelled；重复取消幂等。

## 预算、恢复及失败

编排默认累计 6 次工具模型请求、100000 保守预留 tokens；每命令 90 秒、每请求 30 秒，严格上限分别 20 次/500000/120 秒/60 秒。正常流程三次工具模型请求；P3 相关性另按原预算累计（默认每步两批/60 秒、共 20 次/200000 预留 tokens）。两层预算分别记录，不混成实际计费。

任何请求先持久化调用/token 预留，之后才联网；失败/超时/中断的用量未知保留 null，不能记成零用量。继续可显式提高 schema 范围内预算，不能清零累计成本。进程中断的 running 尝试在恢复时标为 interrupted，不伪称成功。

| 状态               | 含义与后续动作                                                  |
| ------------------ | --------------------------------------------------------------- |
| completed          | 确定集合已完整判断，后端事实读取成功                            |
| no_results         | 完整遍历/判断且无确定或待确认项，允许空结果结论                 |
| needs_confirmation | 条件/地点歧义或候选 uncertain；需要新消息确认，不生成全量零金额 |
| query_failed       | 候选/事实查询失败；retry 保留成本后重新回源                     |
| model_failed       | 工具协议、输出/证据、上游错误；显式 retry，不自动循环重试       |
| incomplete         | 未查完/位置或进程中断；continue 或缩小范围                      |
| budget             | 累计/分步预算暂停；continue，可显式提高累计上限                 |
| timeout            | 单次/整步超时；continue/retry，保留预留成本                     |
| cancelled          | 用户/请求取消；显式 continue/retry 或新消息                     |

跨进程 cancel 立即禁止旧执行写回；上游在途请求可能已产生费用、在下一持久化检查时才被拒绝，本轮不声称可撤销提供商计费。request.signal 取消/超时会中止 fetch；不遵守 signal 的适配器由 Promise.race 和回调代际保护隔离。

## 可追溯性与验证

记录 parse/candidate/judgment/facts/finish 各阶段开始/成功/失败、耗时、安全错误码、必要条件、候选/判断覆盖、精确结果引用/字段依据、契约/规则/提示词、请求/返回模型和用量。查询或判断失败 result 为 null 或 facts=null，不创建空汇总；待确认与未评估分开。记录不保存配置对象、密钥、请求认证头、上游原文或任意异常堆栈。

验证命令：

```bash
npx vitest run tests/unit/ai-assistant-*.test.ts
node --import tsx scripts/check-ai-assistant-loop-protocol.ts --real
node --import tsx scripts/check-ai-assistant-followups.ts --real
node scripts/with-dev-db.mjs tsx scripts/check-ai-assistant-conversations.ts
node scripts/with-dev-db.mjs tsx scripts/check-ai-assistant-execution.ts
node scripts/with-dev-db.mjs tsx scripts/check-ai-assistant-execution.ts --real
```

仅首次助手专用迁移需要 conversations 脚本的 `--migrate`；预检只允许本轮唯一新增迁移，拒绝其他待迁移/失败迁移。开发脚本双重检查 URL 与真实库名/用户，业务只读事务，合成助手记录验证后清理。所有报告独立新建；失败、诊断脚本异常和未验证项保留。实际结果、精确文件和最终检查见[交接](handoffs/2026-11-17-p4-02-05.md)。不运行 E2E，不代表真实登录 HTTP、完整 P6 或多实例负载验证。

## P6 修复及文字视图

- `details / by_distributor / stock / purchase_remaining / distributors` 为受控视图。库存两种口径和地点列表不交模型计算；只读事务继续校验开发目标。物料采购来源身份不按目录去重，商品来源余量澄清；地点结果按真实解析 ID、理由/匹配片段投影，不输出完整地址/电话。
- 编排向解析提供后端 `referenceNow` 与 `Asia/Shanghai`。相对月份优先枚举；明确日期区间与 month 不能并给，null 删除旧日期再应用 month 是一致操作。既有查询内“这些还剩多少／这次买的还剩多少”按后端明确 R08 规则规范视图且不允许模型更改原条件；更复杂问法仍须模型解析。
- 完整判断含 uncertain 时仅查询 include 身份，保留 needs_confirmation/selectionIsPartial 和明确提示；判断/查询失败、未完成仍无成功 facts。开始记录在阶段完成后更新为终态，避免完整执行被显示为停止。
- relevance-v3 使用请求内 C0…短引用和逐字段 index，后端恢复原身份再执行原严格证据检查。来源/提示/模型配置不一致会重新判断且保留累计消耗；金额、数量、库存永远重新读取。

服务 mock、完整冻结矩阵、真实模型、实库 SQL/服务、桌面手机和失败明细分开见 [P6 交接](handoffs/2026-11-17-p6-01-04.md)与[运行说明](text-guide.md)。AI 助手影响：已同步；不新增业务写工具、语音或部署能力。

## P7—P10 更新（2026-11-18）

当前认证入口改用 `assistant-agent-v1` 的统一 `next_action` 循环，旧固定三步函数仅保留历史协议回归；本文件上方的三步/模型不可见数值说明为历史 P4/P6 行为。现行工具、默认 12 调用/200000 预留 tokens/120 秒、集合 journal、跨集合比较与回答校验见 [新架构](composable-architecture.md)。底层 v1 业务查询/语义和权限继续复用，未增加业务 SQL/写入接口。
