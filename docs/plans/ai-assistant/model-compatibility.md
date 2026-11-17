# P4-01：模型与原生 fetch / SDK 验证

2026-11-17（Asia/Shanghai）。本任务已完成最小真实接口验证；不交付业务工具注册、自动工具循环、会话、HTTP 路由或界面。P3-03 的 JSON 相关性报告是既有证据，本报告的普通响应、工具、流式和多轮为本轮独立调用。

## 独立配置

服务端入口：`src/lib/ai-assistant/model-config.ts`；示例见 `.env.example`。

| 用途       | 密钥/接口地址优先级                                                                                            | 模型优先级                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 助手       | `ASSISTANT_API_KEY/BASE_URL` → `DEEPSEEK_API_KEY/BASE_URL` → 地址默认 `https://api.deepseek.com`；密钥无默认值 | `ASSISTANT_MODEL` → 固定默认 `deepseek-flash`                               |
| 相关性判断 | `ASSISTANT_RELEVANCE_API_KEY/BASE_URL` → `ASSISTANT_API_KEY/BASE_URL` → DeepSeek 对应配置                      | `ASSISTANT_RELEVANCE_MODEL` → `ASSISTANT_MODEL` → 固定默认 `deepseek-flash` |

每个字段独立解析；空白视为未配置，HTTPS 地址拒绝用户信息、查询串和片段，并规范化末尾斜线。更换提供商时应同时设置匹配的密钥、地址和模型。仅凭地址或模型名不能判断兼容性，需重跑最小验证。配置对象含密钥，只能用于服务端内部，不能返回 DTO、传入客户端或直接日志化；报告仅记录来源变量名。

移除了相关性判断对 `DEEPSEEK_VISION_MODEL` 的回退。图片识别继续使用原图片配置；名称标签识别属于既有独立功能，本轮未改变。即便图片和助手恰好同为 `deepseek-flash`，也不再形成模型配置依赖；单测用不同模型名验证两种用途的隔离及相关性覆盖项的优先级。

本轮本机 `.env` 中助手/相关性覆盖项均未配置，实际复用 DeepSeek 密钥和地址，助手模型来自固定默认值。没有修改本机密钥或 `.env`。相关性判断接入统一配置后，本机有效模型仍为 `deepseek-flash`；原 JSON 请求、语义提示词与业务契约不变。若其他环境过去仅靠图片模型变量选择相关性模型，应显式迁移到 `ASSISTANT_MODEL` 或 `ASSISTANT_RELEVANCE_MODEL`，再验证该模型；本轮未检查或修改生产配置。

## 方法与版本

- 运行入口：`node --import tsx scripts/check-ai-assistant-protocol.ts --real`。不带 `--real` 时不联网、不收费、不生成成功记录。
- 脚本仅加载 `.env`（不覆盖已有进程变量）；不是 Next.js 完整 `.env*` 加载链。应用运行时按 Next.js 服务端加载顺序读取。无数据库模块或业务 fixture；只有合成词 `BLUE`、`OK`、`TOOL_OK`、`STREAM_OK` 和协议说明。
- 工作区 HEAD：`67241b8cce746139036cc9f483992bf4ec2dcdf0`，附本轮未提交改动。报告记录 HEAD，但不等于脚本已提交；执行后增加的流式失败用量保留逻辑只做离线 mock 验证，没有再次真实调用。
- Node `v24.14.1`，内置 undici `7.24.4`；实际安装与 lock 一致：Next `16.4.2`、TypeScript `5.9.3`、Zod `4.6.5`、dotenv `16.6.1`、tsx `4.23.15`、Vitest `5.0.3`。
- `ai`、`@ai-sdk/deepseek`、`@ai-sdk/openai-compatible`、`openai` 均未安装、未锁定；本轮没有 SDK 版本可报告，也没有 SDK 实测。不以 package.json 范围代替实际安装版本；不新增依赖。
- 实际接口：`POST https://api.deepseek.com/chat/completions`，请求和返回模型均为 `deepseek-flash`。非流式使用 Chat Completions JSON envelope；流式使用 `text/event-stream`、`delta.content`、结束原因和 `[DONE]`。
- 公共参数：`temperature=0`、`max_tokens=128`、单请求超时 30000 ms、响应总预算 64000 字节、`redirect=error`、`cache=no-store`，无自动重试。官方 `api.deepseek.com` 显式 `thinking={type:disabled}`，其他地址不自动发送该扩展。没有将其他提供商、思考模式或其他部署运行时算作通过。

## 真实结果

成功调用发生在北京时间 2026-11-17 10:00:52～10:00:56；五次均 HTTP 200。以下耗时为单次完整响应/流读取，不是稳定性、吞吐或成本基准。

| 用例        | 验证内容与实测结果                                                                                                                      | 耗时 ms | 输入/输出 tokens |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------: | ---------------: |
| plain       | system/user 消息，要求记住 BLUE 并仅回复 OK；实际匹配，`finish_reason=stop`                                                             |    1199 |           28 / 1 |
| multiturn   | 将上次真实 assistant 消息放回历史，追加询问代号；实际匹配 BLUE，`stop`                                                                  |     524 |           43 / 2 |
| tool-call   | 强制调用合成 `protocol_echo`，返回 `type=function`、非空 id、合法 JSON 字符串参数 `{"value":"BLUE"}`、`finish_reason=tool_calls`        |    1003 |         300 / 34 |
| tool-result | 按真实 tool_call_id 回传固定 `role=tool` 消息，追加只输出 result 的要求；实际匹配 TOOL_OK，`stop`                                       |     867 |           86 / 3 |
| stream      | `stream=true`、`stream_options.include_usage=true`；实际匹配 STREAM_OK、3 段非空内容、5 个 JSON SSE 事件、`stop` 及 `[DONE]`，1627 字节 |     944 |           10 / 3 |

流式首段内容 822 ms，HTTP 头 152 ms；usage 事件不混入正文。工具定义为最小 JSON Schema object，`required=[value]`、`additionalProperties=false`，请求 `tool_choice={type:function,function:{name:protocol_echo}}`、`parallel_tool_calls=false`。本地仅严格检查结果并构造固定响应，未执行真实业务函数；没有工具注册表或通用循环。

总用量：467 输入 + 43 输出 = **510 tokens**。接口报告每次缓存命中均 0；实际货币费用未测，不据此推算账单。真实报告保留每次参数、消息、返回模型、usage（含缓存计数）、完整耗时、首段耗时和格式验证结果；不保存认证头、密钥、上游完整正文或任意异常堆栈。

原始记录：

- [首轮受限网络失败](verification/2026-11-17T02-00-20-435Z-p4-01-protocol.json)。
- [联网后五项成功](verification/2026-11-17T02-00-52-043Z-p4-01-protocol.json)。

## 失败与验证边界

首轮在受限沙箱中 plain/tool-call/stream 三次分别耗时 22/2/1 ms，均 `NETWORK_ERROR / ENOTFOUND`，没有 HTTP 响应；multiturn/tool-result 因前置调用失败而跳过。三次用量未知，不能记为零用量或模型失败。随后按权限流程联网执行同一脚本，五项通过；没有覆盖或删除首轮报告。没有真实超时、429、5xx 或接口不兼容记录，不制造这些故障来增加调用。

离线 mock 覆盖配置隔离/优先级/非法地址，固定五请求、严格工具参数、失败前置跳过、安全错误记录、网络原因码、SSE 字节分片/CRLF/usage-only 事件/结束标记/响应预算。截断和超限不能成功；已观察到的流式模型名、用量与事件计数在随后失败时仍保留。mock 不是实际接口故障恢复证据。

本轮每个真实协议路径只跑一次，不是三次语义核心稳定性评估；未重跑 P3 核心，也未改变其冻结基线或验收期望。多轮仅证明客户端重传合成历史消息有效，不证明服务端记忆、条件解析、持久会话或账号隔离。工具仅验证强制单个非流式函数调用和手工单次回传，不证明 `auto` 选择、多工具、并行调用、流式工具参数拼接、递归循环、业务权限或错误恢复。流式仅为普通文本，不证明网页端流式展示或取消功能。`strict` 模式、思考模式及 `reasoning_content` 未验证。

## 选型结论与下一步

**本阶段选择继续使用现有原生 fetch，不新增 SDK。** 当前真实接口已能用原生 JSON/SSE 表达所需的最小协议，现有 JSON 相关性也已采用 fetch + Zod；现阶段增加未实测 SDK 适配器不能增加本轮已验证能力，还会新增版本与扩展参数透传的维护面。保留可注入 fetch 的独立 CLI 验证器，后续生产调用边界另由 P4-02 实现；不把本脚本直接当完整助手传输层。

这不是 SDK 不兼容的结论。若 P4-02 后确需多提供商适配或 SDK 的流式事件管理，先固定 SDK 与 provider 版本、确认 `thinking`/工具参数的实际透传和错误/用量语义，再使用同样合成用例验证，不能静默换掉已验证路径。当前已验证可先用非流式工具决策；若未来启用流式工具或自动选工具，须在对应实现前补齐真实兼容性证据。

下一条可执行动作：登记 **P4-02**，读取本报告及 P2/P3 服务契约，设计受控工具清单与严格参数、认证上下文、后端事实引用、错误映射及轮数/预算，先用 mock 验证边界。接入助手 HTTP/多实例前解决既有内存运行存储/可靠同进程路由问题。会话属于 P4-03，助手界面属于 P5，不在本轮实现。

**AI 助手影响：已同步。** 同步独立模型配置、相关性配置消费、计划/决策/维护/验收与交接；无业务字段、金额/单位、查询或语义契约变化。本轮不访问任何数据库，不迁移、不部署、不执行 E2E。

## P4-02～05 后续兼容性（2026-11-17）

后续继续使用原生 fetch、单个强制非流式函数及固定 call id 回传，注册严格业务阶段，未启用 auto/并行/流式工具或 SDK。新增真实兼容性验证使用实际 Zod 转换后的 patch JSON Schema，连续 plan_query/query_facts/finish 三次调用通过，输入/输出 4050/168 tokens；三个指定追问的真实合成解析通过，8013/269 tokens。原始报告见 [顺序循环](verification/2026-11-17T02-30-28-750Z-p4-loop-protocol.json)及[追问](verification/2026-11-17T02-36-37-698Z-p4-followups.json)。

另一次真实模型+开发库只读主例三次工具调用、一次既有 JSON 相关性调用通过，45682/3450 tokens；其中相关性 41376/3210，44 条完整判断。该实际请求使用相同 deepseek-flash/原生 fetch；未引入新 SDK/依赖/思考模式。合计本轮十次真实调用 57745/3887 tokens，货币费用未知。真实故障未故意制造；服务 mock、数据库合成记录及真实业务联调边界分别记录于[交接](handoffs/2026-11-17-p4-02-05.md)。本节更新后续能力，不回写 P4-01 当时验收范围。

## P5 HTTP 消费验证（2026-11-17）

继续采用 P4 原生 fetch、强制单个非流式工具与固定 call id 回传；无新协议/SDK/依赖。浏览器轮询已持久化阶段，不启用流式工具或 auto 选择。

一次真实认证 HTTP 查询仅发送一个必要物料 ID 和合成查询指令，不含名称、价格、联系方式或账号。deepseek-flash 连续 plan_query/query_facts/finish 三次通过，输入/输出分别为 2606/148、784/17、826/16，总计 **4216/181 tokens**。真实后端读取采购/库存，精确采购身份另由 P2 独立核对；无语义过滤，因此没有相关性调用，不代替 P6 自然语言主例回归。

报告：[真实模型 HTTP 与浏览器](verification/2026-11-17T04-24-03-151Z-p5-ui.json)。故障/预算测试在调用前暂停，未产生模型请求；延迟旧响应采用浏览器 HTTP mock。先前带 --real-http 的失败脚本均在真实调用分支前退出，旧报告 realModel 标记表示请求运行模式，不表示真实调用成功；最终脚本分别记录 requestedRealModel 和 realModelAttempted。未制造真实 429/超时/提供商故障，不声称这些路径实测。实际货币费用未知。

## P6 当前文字协议（2026-11-17）

继续 deepseek-flash、原生 fetch、强制单个非流式工具；没有新 SDK、auto、并行或流式工具。编排为 orchestration-v5（参考时钟、相对日期/条件 patch、两种库存及直接地点视图），相关性为 relevance-v3（C0…短引用、显式证据 index，后端恢复并严格校验）。旧报告版本不改写。

P6 完整矩阵、核心/语义边界各三次、当前开发库/浏览器和真实失败明细见 [P6 交接](handoffs/2026-11-17-p6-01-04.md)。真实失败包含非法证据/长引用、月份误查、日期 null 与 month 的校验缺陷及库存口径误解；分别修复协议/时钟/一致日期操作/明确 R08 后端规则，不伪称提供商永不出错。更换模型/提示后重新验证，检查点不能复用旧配置判断。

逐次调用、实际 tokens、失败消耗及样本延迟汇总见[性能记录](verification/2026-11-17-p6-performance.json)。没有价格或账单依据，货币成本为 null；未验证真实 429/5xx/超时、其他 provider、SDK、思考模式、多实例负载、生产或语音。AI 助手影响：已同步。
