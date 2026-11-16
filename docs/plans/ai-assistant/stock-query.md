# P2-05：当前库存查询

2026-11-16。专用服务 `queryAssistantStock(request, input)`，沿用 v1，不改变采购与候选契约。

输入 `{mode, query, selectedItems?, selectedPurchases?}`：

- `mode=catalog_current`：查询目录当前总库存；`query` 可为目录查询，也可为历史采购查询。历史采购仅确定目录对象，库存再读取这些目录的全部当前批次，不附加采购日期、地点或供应商筛选。同目录多采购去重一次。
- `mode=purchase_remaining`：仅支持物料采购查询，读取选定采购行 `remainingQty`，采购量单独返回。商品采购没有来源余量字段，拒绝此模式，不能拿商品总库存或采购量代替。
- `selectedItems` 只用于目录 query；`selectedPurchases` 只用于采购 query。省略表示完整硬范围，`[]` 表示空选择；重复、错类型、不存在或范围外引用拒绝。提交选择不证明语义判断正确。
- 复用 `assistantQuerySchema` 的硬范围、引用存在性与地点验证。库存一次返回完整有界集合，不使用分页快照；拒绝 cursor，`pagination.limit` 不限制库存输出。新调用重新读取实时事实，返回观察时间。单次候选/结果及物料库存批次扫描均最多 5000，超限报错，绝不静默截断。

目录结果 `catalogStock` 按对象返回 `knownStock`、`unknownStockBatchCount`、`stockBatchCount` 和单位；无采购批次物料为已知 0，商品直接使用 `Product.stock`，批次数为 null。来源结果 `sourceStock` 逐行返回真实目录/采购/批次身份、单位、`purchasedQuantity` 与 `remainingQuantity`（未知为 null）。仅所选模式对应的结果数组有值。汇总 `quantities` 按单位返回已知库存小计、未知库存对象数与未知批次数；来源模式对象数按采购行，目录模式按目录款。未知不补零；已知小计 0 与完整库存 0 含义不同。

服务先 `requireAccount`，当前共享业务数据无录入者过滤；不接受账号、owner 或自由 SQL。在单次 `READ ONLY` / `RepeatableRead` 事务内校验范围及读取库存，失败原样传播。返回范围候选数、选定候选数、去重目录数、`traversal=complete` 与 `semanticEvaluation=not_performed`；失败没有完整空结果。没有 HTTP 路由、模型注册或界面。

物料复用页面相同 `materialStockSummary`；读取持久化 `remainingQty`，已包含库存盘点及采购数量更正后的结果，不从采购量或调整记录重算。`correctedRemainingQuantity` 在采购更正时保留原已用数量。当前 DIY 来源代码只保存用料/成本行，不自动扣减物料批次库存；`usageUnit` 还可能与采购单位不同，不能将 DIY 用量直接相减或换算成消耗。这里遵守现有业务页面，未新增扣库存行为。商品使用现有 `Product.stock`，包含来源变动与盘点结果。

## 验证结果与限制

- 本轮新增 33 项服务/契约测试，连同原助手与库存测试共 9 文件、195/195 项通过。覆盖采购 10/来源余量 2/总量 6 加未知批次、采购量更正保留已用量、真实 `adjustMaterialStock` 业务函数盘点后读取、不再次叠加调整、空选择、单位分组、小数、无批次、错配引用/范围、预算、认证及每次重新取值。
- 开发库命令：`node scripts/with-dev-db.mjs tsx scripts/check-ai-assistant-stock.ts --save`。强制校验两个连接及实际库名/账号是隔离开发库，事务确认 `transaction_read_only=on`；20 秒事务、8 秒语句超时。仅本地保存脱敏报告，未修改业务数据。
- 2026-11-16 16:14:44（Asia/Shanghai）：210 物料、127 商品、213 物料采购行，与业务页面 `materialStockSummary`、独立库存 SQL 及商品 `stock` 一致；页大小 1 不截断库存输出。3 个多批次物料均验证了带日期/供应商/对象与精确采购行的历史选择：各有 1 批在日期外，来源余量 4/1/1，全部当前库存 6/2/3。见[脱敏结果](verification/2026-11-16-p2-05.json)。
- 实际库 1 条零库存、1 条库存更正、1 条余量与采购量不同；11 条带 DIY 用料、其中 4 条使用单位不同。所有来源余量均逐行等于持久化 `remainingQty`，未按 DIY 行再次扣减。真实库未知库存为 0 条，未知/全未知/未知转已知仅用构造测试覆盖；不能称真实库未知场景已验证。余量不同不自动证明 DIY 消耗原因。
- 类型、全仓 lint、格式及空白检查通过。认证以 mock 会话运行真实 `requireAccount` 验证，开发库脚本调用内部数据层，不含真实登录 HTTP、模型或助手评估。未运行 E2E、全量测试或构建；未访问生产库、迁移、部署或提交。下一项 P2-06。
