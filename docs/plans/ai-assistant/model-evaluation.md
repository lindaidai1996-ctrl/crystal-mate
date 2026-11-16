# P3-03 / P3-04：受控相关性判断与执行契约

契约先行（2026-11-16）。内部服务，不新增 HTTP、工具注册或界面。

- 输入是认证服务读取的 v1 召回快照，不接受客户端候选、账号、自由 SQL、工具定义或修改后的证据。模型只看语义条件、v1 规则、候选语义字段、召回来源和确定性判断；不发送金额、库存、地址或认证信息。
- 模型输出严格 JSON，逐候选引用完整身份 key、include/exclude/uncertain、原字段证据索引和理由。索引由后端还原原值，再复用 `decisionsForCandidatesSchema`。虚构/错配身份、重复结果、重复或越界证据、额外字段拒绝；缺失结果保留未评估并可重试。冲突和规则分歧保留 uncertain，不静默覆盖 v1。
- 每次运行绑定认证账号、原查询及规则/提示词版本；继续/取消使用 runId 和 revision。运行进程内保留 10 分钟、每账号最多 4 个、全进程 32 个；过期/淘汰/重启明确要求新建，不跨实例恢复。取消和旧响应使用代际校验，旧响应不能提交。
- 分开报告候选遍历、模型判断、未读取、已读未判断及不确定数；累计计数按精确目录/采购身份去重。只有遍历和判断均完成才允许空结果结论；uncertain 不能混入确定选择。
- 执行预算包含累计调用数、累计 token 预留、判断条数，以及每步时长/调用数、单次超时、输入字节和输出 token 上限。失败和超时也消耗调用/预留预算；继续可显式提高累计上限，计数不清零。token 预留按输入 UTF-8 字节（含固定提示）加输出上限保守估计，不等同实际计费；实际用量另记，可未知。
- 候选范围仍采用 P3-02 最多 5000 条的完整有界快照，超限显式失败。此实现提供有界范围内可恢复分批判断，不声称支持任意大范围；没有提高 5000 常量、Top-K 或部分成功冒充全量。大范围需缩小硬范围，后续数据库分块快照/后台任务/共享状态另行实现。
- 只提供确定 include 的精确选择；金额、数量和库存继续由 P2 业务服务读取/计算，部分结果和待确认项必须随选择披露，不生成零金额结论。

验证结果与最终默认值见交接和源码；真实模型检查仅覆盖 JSON 相关性接口，不等于完整 P4 工具/流式/多轮能力通过。

## 调用与输出

`startAssistantRelevance(request, assistantQuery)` 读取范围并返回首个候选页的覆盖状态；不会隐式收费调用模型。`continueAssistantRelevance(request, {runId, revision, budget?})` 在预算内判断；同接口继续预算暂停或重试失败，已经提交的身份不重复判断。`readAssistantRelevance(request,{runId})` 取得当前 revision；`cancelAssistantRelevance(request,{runId,revision})` 中止当前代际。运行没有跨账号共享或客户端直接提交模型结果的入口。

返回 `completeness`、0～1 的遍历/判断覆盖率、已判断集合和已读未判断 key，未读数单列；`attempts` 逐次记录调用序号、精确候选 key、模型版本、耗时、实际已知用量/未知用量、成功/缺失/错误状态及规则保护造成的状态调整。失败批次不提交非法判断，部分合法但缺失的响应仅提交已验证部分，重试仅处理剩余身份。`lastErrorCode` 提供安全错误码；不存上游完整响应/密钥。过期运行明确 `RUN_RESTART_REQUIRED`，旧版本命令为 `STALE_REVISION`，并发执行为 `RUN_BUSY`。

当前默认：batchSize=10、累计 maxCalls=20/maxReservedTokens=200000/maxCandidates=5000，每步 maxCallsPerStep=2/stepTimeoutMs=60000，单次 callTimeoutMs=30000/maxInputBytes=100000/maxOutputTokens=4000。输入过大先缩小批次，单条仍超预算则暂停，不截掉字段或跳过难例。预算累计 token 预留包含 1024 的协议余量；记录的实际 tokens 与预留分别显示。运行硬上限见 Zod schema，不通过继续重置成本。

模型配置：可选 `ASSISTANT_RELEVANCE_API_KEY` / `ASSISTANT_RELEVANCE_BASE_URL` / `ASSISTANT_RELEVANCE_MODEL`，缺省复用 DeepSeek 对应配置及现有 `DEEPSEEK_VISION_MODEL`，最终默认 deepseek-flash；本轮实际验证了该模型的 JSON 接口，未由图像能力作推断。没有引入 SDK 依赖；P4-01 仍需验证工具、流式和多轮以及最终 SDK 选择。

金额/库存消费必须使用 `confirmedSelection` 对应的精确采购/目录引用，显式空数组不得省略成全范围；只读后端重新检查原查询硬范围与引用。模型判断快照不承诺后续事实未变，当前采购金额/数量/库存重新读取并标注观察时间。`selectionIsPartial` 在未完成或有 uncertain 时为真；`canConcludeNoMatches` 在完整且无 include/uncertain 时才为真。没有新增通用对话编排或自动汇总工具循环。

本轮实际验证：41 项新增模型/服务测试及既有助手相关检查；真实模型固定核心三次、构造边界三次、开发库只读一次和最小 JSON 检查。模型失败、取消、继续/重试和跨页多批执行主要为 mock 服务验证；真实模型采用单个完整有界批次，未故意制造真实故障或限流。报告与失败差异见[索引评估](semantic-index-assessment.md)及[交接](handoffs/2026-11-16-p3-03-05.md)。
