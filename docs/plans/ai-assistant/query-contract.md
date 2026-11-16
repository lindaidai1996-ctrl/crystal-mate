# AI 助手：查询与返回契约 v1

日期：2026-11-16。对应 **P2-01**。运行时定义见 `src/lib/ai-assistant/contracts.ts`，示例与拒绝案例见 `tests/unit/ai-assistant-contracts.test.ts`。

这是可执行的 Zod 数据契约；P2-02 地点/字典、P2-03 候选/详情与 P2-04 采购明细/汇总服务已连接数据库，尚未连接 HTTP 工具；P3-03/P3-04 另提供[受控模型判断/执行契约](model-evaluation.md)，不改变这些 P2 业务查询接口。运行时认证、引用存在性、字段来源和运行归属由服务验证，不能仅因 schema 通过就认定查询已被授权或结果属实。

## 查询输入

`assistantQuerySchema` 使用严格对象，版本为 `v1`；支持目录 `catalog` 与采购行 `purchases`。所有参数由 JSON 原类型校验，不自动把字符串转数字，不接受额外字段、自由 SQL、账号、录入者或所有者条件。

| 字段                  | 约定                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `itemTypes`           | `MATERIAL` / `PRODUCT` 的非空去重数组                                                                                               |
| `hard.purchaseDate`   | 对应 `MaterialBatch.receivedAt`，仅采购查询可用；日历日期 `[from, to)`                                                              |
| `hard.createdAt`      | 带 `entity` 的建档时间，`catalog` / `purchase` / `batch` / `distributor`；带时区偏移的时间戳 `[from, to)`；目录查询仅接受 `catalog` |
| `hard.distributorIds` | 多渠道商 ID，组内 OR；仍须后端核验权限、存在性与地点条件                                                                            |
| `hard.items`          | 带 `MATERIAL` / `PRODUCT` 类型的 ID 引用；不得超出 `itemTypes`                                                                      |
| `hard.categories`     | 带分类类型、ID 与显式 `includeDescendants`；组内 OR，是否递归不可猜测                                                               |
| `hard.tagIds`         | 用户明确要求的硬标签；组内 OR，不能从软语义偷偷生成                                                                                 |
| `hard.location`       | 原始地点词与 `exact_place` / `area` 精度；必须先解析，未解析不能查询更大范围                                                        |
| `semantic`            | `concept`：材质/用途/形态/其他；`relation`：`is` / `used_with` / `not`；数组内条件 AND                                              |
| `ruleVersion`         | 当前为 `v1`，对应 `semantic-rules.md`                                                                                               |
| `pagination`          | `limit` 为 1～100 的整数，默认 50；可附服务签发的结构化游标                                                                         |

不同硬条件之间 AND；省略条件表示不限制，显式空 ID 数组会被拒绝，防止误把“没有匹配渠道商”变成“不限渠道商”。确已解析且无匹配的地点应返回完整的空范围，不要删除地点重查。当前目录的渠道商条件表示“存在对应渠道商采购关联”；这不是目录所有者条件。

`purchaseDate` 不接受时间戳、非法日历日期、相同或逆序边界。`createdAt` 不接受无偏移的本地时间，按实际瞬间比较而非字符串排序。北京时间常量为 `ASSISTANT_TIMEZONE = Asia/Shanghai`；相对时间尚未实现，后续由后端注入时钟并计算明确边界，不把模型提供的“当前时间”当可信时钟。

主案例不依赖模型即可表达：

```json
{
  "version": "v1",
  "subject": "purchases",
  "itemTypes": ["MATERIAL"],
  "hard": {
    "purchaseDate": { "from": "2026-11-01", "to": "2026-12-01" },
    "location": { "text": "荔湾广场", "kind": "exact_place" }
  },
  "semantic": [
    { "concept": "material", "text": "绿松石", "relation": "is" },
    { "concept": "purpose", "text": "制作配件（含配饰、圆珠）", "relation": "is" }
  ],
  "ruleVersion": "v1",
  "pagination": { "limit": 50 }
}
```

地点由 P2-02 解析，P2-03 在同一只读事务内调用解析后应用范围。契约测试以冻结快照表达 44 条候选；真实候选遍历另见[候选查询说明](candidate-query.md)与 P2-03 验证记录。

## 实体、候选和证据

目录身份为 `item.type + item.id`，采购身份另保留 `purchase.type + purchase.id`。`purchase` 在目录候选中为 `null`，采购候选必须有值；物料只能配物料采购行，商品只能配商品采购行。同目录的不同采购行分别保留。

`entityRefSchema` 还支持渠道商、两类分类、标签和批次，ID 使用当前仓库的 CUID 格式。格式正确不保证记录存在；后端必须以当前授权范围核对，不能按名字去重或信任模型给出的关系。

`fieldEvidenceSchema` 包含实际实体引用、白名单字段和原值：

- 字段为 `name`、`aliases`、`notes`、`description`、`area`、`address`、`receivedAt`、`createdAt`。
- 原值为字符串、字符串数组或 `null`，空字符串与未知值保留；不以缺失补零。
- 分类/标签依据使用实际分类/标签实体 ID 和 `name` / `aliases`，不虚构目录嵌套字段。
- 查询服务只返回该次判断需要的字段；地址等信息不默认全量发给模型，禁止附带电话、微信、认证信息等额外字段。

`queryCandidateSchema` 保存身份和后端提供的证据。`semanticDecisionSchema` 保存相同身份、`include` / `exclude` / `uncertain`、非空证据、理由与规则版本；`not_evaluated` 属于执行计数，不是判断结果。证据不足时仍需引用实际返回的空字段等观察，不生成“推断字段”。

模型或其他调用者输出必须通过 `decisionsForCandidatesSchema(serverCandidates)`：拒绝未返回的目录/采购组合、重复判定、其他候选的证据，以及修改过的实体、字段或值。允许部分判定与空判定，缺失候选仍未评估，不能自动排除。该校验只证明引用来源一致，不证明理由或语义判断正确；后者由 P3 验收。

## 分页与完整性

`candidatePageSchema` 返回版本、服务端 `runId`、`queriedAt`、生效查询、当页候选、`nextCursor` 与累计 `completeness`。页内不能重复；采购/目录类型、计数口径与查询一致。累计已读数不能小于当页条数。

游标为 `{runId, scopeKey, after: {type, id}}`。`scopeKey` 为 64 位小写十六进制摘要，绑定归一化查询和认证数据范围；它不是签名或权限凭据。候选遍历约定以实体类型、ID 按固定字节序升序，采购查询使用采购行身份，目录查询使用目录身份。下一游标指向当页最后一行，不能跨运行、跨范围或在完整遍历后继续。

P2-03 已实现服务端运行/游标校验、查询摘要和不可变候选视图，拒绝过期或未签发位置。`queriedAt` 是查询观察时间；首次查询在只读一致性事务内读取并冻结必要字段，后续页使用快照，不承诺跨请求持有数据库事务。重试不会重复累计已读数；重放早期页仍报告运行累计已读前缀。快照到期、淘汰或进程失效必须显式重启运行，不能静默重查。当前进程存储和预算限制见[候选查询说明](candidate-query.md)。

`completenessSchema` 将范围解析、候选遍历、语义判断拆开：

| 字段                       | 口径                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `scope`                    | `resolved` / `unresolved`；未解析时不允许已读数据或已知总数                                    |
| `traversal` / `evaluation` | 分别为 `not_started` / `partial` / `complete`                                                  |
| `countBasis`               | `catalog` 或 `purchase_entry`；以下判断计数沿用此口径                                          |
| `totalCandidates`          | 完整硬范围候选总数；未知为 `null`                                                              |
| `readCandidates`           | 累计去重已读取候选数，不是当前页大小                                                           |
| `uniqueCatalogItems`       | 已读取候选的去重目录数；采购行与目录款数分开                                                   |
| `evaluatedCandidates`      | `included + excluded + uncertain`                                                              |
| `notEvaluated`             | 已读但未判断，等于 `readCandidates - evaluatedCandidates`                                      |
| `unreadCandidates`         | 总数已知时为 `totalCandidates - readCandidates`，否则为 `null`                                 |
| `stopReason`               | 未完成时为 `running`、范围未解析、预算、超时、查询/模型失败或取消；全部读完且判断完才为 `null` |

未完成不能以零结果声称查无记录。全量判断完但有 `uncertain` 时，判断状态可以为 `complete`，仍必须另列待确认项，确定金额仅汇总 `include`。完整空范围须范围已解析、总数与计数全为 0，遍历和判断均完成；与失败、取消或未知总数严格区分。

## 后续衔接

- **P2-02 已完成**：[地点/字典解析](reference-resolution.md)新增专用输入/输出 schema，复用实体和字典字段证据；地点输出使用单独的片段证据，明确区分确定空集合、待确认和未完成，不能仅用区域替代确切地点。
- **P2-03 已完成**：[候选/详情查询](candidate-query.md)实现上述目录/采购候选分页、引用存在性、数据范围、游标与实际累计计数；新增详情专用 schema，沿用 v1。
- **P2-04 已完成**：[采购明细与 Decimal 汇总](purchase-query.md)新增专用 schema，复用目录/采购引用；支持精确采购选择，十进制金额、未知行数、币种和数量单位分别返回。完整选定集合汇总不随当页变化，提交选择不等于语义判断已通过。当前采购币种采用明确标记的 CNY 业务默认，不推断商品售价币种。
- **P2-05**：库存使用[独立专用契约](stock-query.md)，`catalog_current` 与 `purchase_remaining` 分离；历史采购 query 仅选择对象/来源，不限制目录总库存的批次。原 `assistantQuerySchema` 的 subject 不变。
- **P2-06 已完成**：[工具边界](tool-boundaries.md)验证现有认证/审计、账号运行隔离和最小字段；地点/字典也使用显式只读事务。schema 不能替代鉴权。目前无助手 HTTP 路由或对话存储，真实 HTTP/未来会话隔离仍待后续接入。
- **P3-01/P3-02 已完成**：[语义策略与召回](semantic-policy.md)保留 v1 的原查询/候选不变，新增独立召回返回契约。`recallPageSchema` 在候选页面上增加 `policyVersion`、逐候选 `sources` 与全量 `sourceCounts`；独立存储/工具绑定，原候选/采购游标不互通。确定性规则输出复用并校验 `semanticDecisionSchema`，不代表 P3-03 模型判断已完成。
- **P3-03/P3-04**：绑定实际候选验证判断输出；缺失判定、执行预算、错误和取消据实更新累计计数。

后续优先新增工具专用 schema 并复用本契约。若改变已有字段语义或移除字段，应显式升级版本并更新调用者、测试和交接，不能由不同会话分别解释同名字段。

## P3 模型执行消费约束

`start/continue/cancel/readAssistantRelevance` 是独立认证内部服务，使用原 v1 查询与完整有界召回。输出引用证据索引，经后端映射原值并复用本文件的 `decisionsForCandidatesSchema`；候选/采购身份不能由模型生成。运行拥有独立 runId，不接受其他工具游标或客户端候选。缺失判断单独记未评估；分歧/冲突为 uncertain。详细预算、版本和生命周期见[执行契约](model-evaluation.md)。

`confirmedSelection` 仅 include。调用 P2 汇总/库存时必须使用精确选择及原硬范围，并携带 `selectionIsPartial` 和完整性；显式空选择不能省略成全范围。模型失败后不能将空选择生成的零汇总当“无匹配”。`canConcludeNoMatches` 仅在候选遍历与判断全完成、没有 include 或 uncertain 时为真；查询失败直接错误，不产生空成功运行。
