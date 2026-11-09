# 外部实践比较矩阵（EXTERNAL-PRACTICES）

- 轮次：secure-correlation-audit（终稿交付物 2/10）
- 汇总来源：`external/stripe-github.md`、`external/aws-cloudflare.md`、`external/fastify-pino.md`、`external/owasp-otel.md`（全部研究于 2026-11-07 在线读取官方文档/源码，个别含真实 HTTP 探测）。
- 每行标注来源链接与页面日期；标注沿用原始笔记：【文档】/【源码】/【实测】/[推断]（stripe-github.md）、[文档证实]/[推断]（aws-cloudflare.md、owasp-otel.md）、[DOC]/[SRC]/[RUN]（fastify-pino.md）。

## 1. 合并比较矩阵

| Project | ID Ownership | External Exposure | Trust Boundary | Access Control | Storage/CPU Cost | Applicable to Exam |
| --- | --- | --- | --- | --- | --- | --- |
| **Stripe**（docs.stripe.com，读取 2026-11-07） | 服务端生成并拥有（`req_` 前缀）；幂等键（Idempotency-Key）客户端拥有，二者完全分离【文档】 | `Request-Id` 响应头公开文档化并列 **CORS expose**（有意给浏览器 JS 读）【文档+实测 curl api.stripe.com 401/404，2026-11-07 15:44 UTC】 | 客户端无注入/覆盖机制【文档（无此协议）+推断】 | Dashboard Logs 查询需团队成员角色含 "View events and logs"（15+ 角色矩阵区分）【文档 roles 页】 | 请求+响应全文级云端留存：GET 31 天 / 非 GET 15 个月【文档 support.stripe.com】；依赖集中平台 | 借鉴 ID 所有权与幂等键分离；集中日志平台不适用（违反 LAN/on-premise 边界）。迁移成本低【推断】 |
| **GitHub**（docs.github.com，读取 2026-11-07） | 服务端生成并拥有（`X-GitHub-Request-Id`，5 段 hex）【文档示例】 | 所有响应（含 200 示例）带头；列 CORS expose【文档 REST getting-started 页】 | 客户端无注入机制；格式无稳定性承诺，须不透明使用【文档+推断】 | 客户无法自查日志；支持工单需提供 request ID + 时间戳【文档 Copilot troubleshooting 页】 | 未知（未公开，如实记录未找到） | 证明「响应头暴露服务端关联 ID（含 200）」是大规模生产 API 通行做法，无需格式承诺。迁移成本极低【推断】 |
| **GitLab self-managed**（docs.gitlab.com + labkit/workhorse/rails 源码，读取 2026-11-07） | 服务端生成（入口 Workhorse 默认生成 ULID）【源码 labkit correlation/generator.go】 | 全部响应带 `x-request-id`【文档 tracing_correlation_id 页】；另经 `X-Gitlab-Meta` 头暴露 context【源码 labkit-ruby rack.rb】 | **默认忽略客户端传入 X-Request-ID**（`propagateCorrelationID` 默认 false，workhorse main.go:125；传播可限信任 CIDR）【源码】；Rails ActionDispatch::RequestId 层仅清洗不验证（≤255 字符 alnum）——不可信流量直连 Rails 即可注入【源码 rails request_id.rb】 | self-managed 无应用内日志查询权限：查日志=服务器管理员 shell/文件访问；Performance Bar 需认证会话【文档+推断】 | 每请求一次 ULID + 每日志行一个 `correlation_id` 字段（≈26 字符），可忽略【源码+推断】；本地文件日志，无强制集中平台 | **与 Exam 最同构**（on-premise、结构化 JSON 日志、无 Dashboard）：默认忽略客户端头 + 本地 grep 调查可直接移植。迁移成本低【推断】 |
| **AWS API Gateway（x-amzn-RequestId）**（docs.aws.amazon.com，读取 2026-11-07） | 网关发起点，但**客户端可以 UUID 格式覆盖并回显**【文档证实 access-logging 页】 | 每个响应头返回（含 200）【文档证实】 | 不可信：非 UUID 注入值被哨兵 `UUID_REPLACED_INVALID_REQUEST_ID` 替换后落日志【文档证实】 | 日志读取：IAM `logs:GetLogEvents`/`logs:FilterLogEvents` 限定 log group ARN；日志写入：账户级 `cloudWatchRoleArn` 角色（读写授权面分离）【文档证实】 | 访问日志存客户 CloudWatch（自选字段）；执行日志 1KB/事件截断、自动脱敏 authorization/API key【文档证实】 | 模式可借鉴（格式校验+哨兵替换），IAM/CloudWatch 机制不可搬；Exam 服务端生成即可让防伪问题消失【推断】 |
| **AWS API Gateway（extendedRequestId：x-amz-apigw-id / apigw-requestid）**（同上 + re:Post S6） | **服务端生成；『An API caller can't provide or override this request ID』**【文档证实】 | 每个响应头返回（含 200），官方指导用户交给 AWS Support 排障【文档证实】 | 可信身份：保留头命名空间 `apigw-*`/`x-amz-*`/`x-amzn-*` 映射不可改写【文档证实】 | 同上 | 同上；被鉴权/限流拒绝的请求也进访问日志【文档证实 re:Post】 | **对 Exam 最有参考价值的单条**：服务端生成、响应头公开、不当秘密；一个 requestId 同时做日志键与响应头则防伪问题消失【推断】 |
| **Cloudflare（CF-Ray / Ray ID）**（developers.cloudflare.com，页面日期 Oct 15–Nov 3, 2026） | Cloudflare 边缘生成【文档证实 http-headers 页，Oct 28, 2026】 | 每个响应头返回（含 200）且与发往源站的值相同；官方建议源站记入自身日志做关联键【文档证实】 | 边缘生成、客户端无输入路径【生成方文档证实；「不可覆盖」为推断】；Argo 下源站侧 colo 后缀可能被改【文档证实】 | 查询：Security Events（全套餐、**抽样数据**）；Log Explorer（`Logs Read` token / Log Share Reader 角色，付费 add-on，2 年 $0.10/GB/月）；Logpush 配置（`Logs Write` + 目的地所有权挑战）；Logpull 仅 Enterprise【文档证实】 | Logpush 无 CF 侧存储，落地客户目的地；HTTP 请求 ~1.5–3 kB/条未压缩；边缘生成 CPU 开销官方未披露【文档证实】 | 「边缘生成+全响应暴露+源站日志关联」与 Fastify 入口等价；CF 查询面依赖集中平台（Exam 无此设施无此需求）；colo 后缀编码位置信息对 Exam 是不必要的 metadata 泄露面【推断】 |
| **Fastify 5.8.5**（fastify.dev + 本地 node_modules 源码，2026-11-07） | 服务端拥有：默认每进程计数器 `req-<base36>`（req-id-gen-factory.js:28-41），可自定义 genReqId；开启 requestIdHeader 后客户端头原样胜出、无校验（req-id-gen-factory.js:45）【SRC】 | **无**：核心不通过任何响应头回 reqId（reply.js grep 无匹配）【SRC】；200 响应关联是应用层决策（一行 `reply.header`）[推断] | v5 `requestIdHeader` 默认 `false`（config-validator.js:6,60-61,1265）＝LAN 任何调用方不可设 ID；官方安全警告「Enabling this allows any callers to set reqId / No validation is performed」[DOC]；**v4 默认曾信任客户端头**（v4 Server.md），不可外推 [DOC] | 无内置日志访问控制；查日志=宿主/容器 stdout 权限（部署层）[DOC+SRC] | 每请求 2 行 info（incoming: method/url/host/ip/port；completed: statusCode+responseTime）；reqId 子 logger 绑定创建时预序列化，逐行零增量 [DOC] | 已在用且为推荐形态；Exam `genReqId=randomUUID + requestIdHeader:false` 是 v5 最佳实践显式化 [SRC] |
| **Pino 10.3.1**（getpino.io + 本地源码，2026-11-07） | 无 ID 概念（透传 Fastify 绑定 reqId）；行身份=level/time/pid/hostname/reqId | 无：stdout/文件 JSON，无对外协议 | redact 路径不得来自用户输入（VM 语法检查）；serializer 顶层精确键匹配 | 无查询 API/鉴权/云依赖；transports 为可选 worker-thread 目标 | 无通配符 redact ≈ +2% JSON.stringify（fast-redact 时代文档数字；10.3.1 已换 @pinojs/redact 0.4.0，量级指示性[推断]）；低于级别的方法为 noop（levels.js:85-96） | 已在用（stdout+info+remove:true+err 白名单）；离线/LAN 天然适配；fastify@6 将以 logController 取代部分选项（前瞻项） |
| **OWASP Logging Cheat Sheet**（cheatsheetseries.owasp.org，读取 2026-11-07，页面无版本号） | 不定义 ID；建议 interaction identifier 关联单次交互【文档证实】 | 未规定客户端暴露（原文无此主题）【文档证实】 | 日志系统边界：超出分类容量的数据不得入日志；日志目录 strict permissions；CRLF/分隔符 sanitize【文档证实】 | 日志读取最小授权 + 定期审查 + 访问被记录监控（可需事前批准）【文档证实】 | 规范零实现成本；sanitize/结构化为小额一次性 CPU【推断】 | 高适配：stdout JSON + Pino redaction 已对齐主体；缺口在「进入日志的用户输入统一 CRLF/长度治理」（本轮未逐路径验证，见 FINAL-VERDICT remainingUnknown）【推断】 |
| **OWASP Authorization Cheat Sheet**（同上） | 不定义 ID；客户端可猜标识不可作授权依据（CWE-639 IDOR）【文档证实】 | "Avoid exposing identifiers to the user when possible"（针对授权对象 ID，与随机 UUID 关联键不同类）【文档证实+推断】 | 每请求服务端强制检查；deny by default；client-side/header 数据非权威【文档证实】 | least privilege（水平+垂直）+授权失败必记+集中处理失败逻辑【文档证实】 | 规范零实现成本【推断】 | 高适配：`requestIdHeader:false` 即「不信任客户端标识符」原则的实现实例【推断】 |
| **W3C Trace Context**（REC 2021-11-23 + Level 2 CR Draft 2024-03-28） | 首个生成者创建 trace-id；任何参与方可按规则重启【文档证实】 | traceparent 设计为跨服务公开传播；spec 承认关联隐私风险（"ability to correlate requests"）；**响应方向回传无任何条款**【文档证实】 | **与 Exam 需要的信任模型相反**：格式合法的客户端 traceparent 被接受延续（协议目的）；仅格式非法 MUST 忽略【文档证实】 | 协议层无访问控制概念【文档证实】 | 55 字节头解析/校验，CPU 可忽略；无存储【推断】 | 低-中：单服务无跨进程传播需求；若未来采纳须独立决策「是否信任入站 trace-id」（信任=日志关联可被客户端污染）【推断】 |
| **OpenTelemetry**（opentelemetry.io spec，读取 2026-11-07） | SDK 默认权威随机生成 TraceId(16B)/SpanId(8B)【文档证实】 | 遵循 W3C TC 暴露模型；不定义响应头暴露【文档证实】 | propagator 提取即 remote parent，合法入站 ID 被接受（同 W3C TC）【文档证实】 | SDK 无查询面；授权由后端定义【文档证实】 | 官方「Instrumentation is not free」但无统一数字；原则=默认不阻塞+内存有界；第三方基准个位数–两位数 % CPU（非承诺）【文档证实+第三方推断】 | 低-中：无 Collector/后端时 traces 与 Pino 形成双轨（违背单一权威）；「大厂默认传播头」不构成 Exam 采纳论据【推断】 |

## 2. 对审计三问的跨研究回答（五份外部笔记一致收敛）

1. **关联 ID 是否应通过响应头暴露（含 200）**：Stripe/GitHub/GitLab/AWS/Cloudflare 五家一致把「服务端生成、格式不透明、随全部响应（含 200）返回的关联 ID 头」作为公开协议，且 Stripe/GitHub 均通过 CORS expose 主动暴露给浏览器 JS——**暴露本身不被任何一家视为泄露风险**；OWASP/W3C/OTel 均无禁止条款（证据真空而非明文允许）。秘密性在 ID 的**生成权**，不在 ID 值。
2. **如何防客户端伪造/覆盖**：唯一实证充分的做法是**所有权边界**——labkit/Workhorse 默认忽略客户端传入 X-Request-ID（`propagateCorrelationID` 默认 false，源码级证实）；AWS extendedRequestId 文档明示「调用方不能提供或覆盖」+保留头命名空间；Rails ActionDispatch::RequestId 仅清洗不验证是反面教材（清洗≠认证，依赖拓扑防护）。Stripe 另证：幂等键（客户端拥有）与请求 ID（服务端拥有）应分离。**Exam 现状（`requestIdHeader:false` + genReqId UUIDv4）已与最佳实践一致**（fastify-pino.md §3 [RUN] 守卫测试 2 passed）。
3. **日志调查需要什么授权**：SaaS=产品内角色（Stripe "View events and logs" 权限矩阵）+支持渠道凭 ID 代查（GitHub）；on-premise=OS/文件系统管理员（GitLab self-managed 无应用内查询面）。Exam 属后者：调查授权天然落在部署管理员对 stdout/日志文件的 OS 级访问，产品内无需新增日志查询 API（与 AWS「读日志 IAM 权限与让服务写日志的账户角色分离」同构——查询日志是与读业务数据不同的、可单独授予的授权面）。

## 3. 反模式警示（外部研究对 Exam 的负面清单）

- CF-Ray colo 后缀把基础设施位置编码进公开 ID——Exam 的 UUIDv4 无此问题，也不应引入。
- CloudWatch/Security Events 类集中查询平台是多云大流量产物；Exam（单部署、stdout、无 dashboard）引入即违反 LAN/on-premise 与离线约束（AGENTS.md §1）。
- W3C TC/OTel 的信任模型（接受合法入站 ID）与 Exam 运营关联键信任模型（服务端权威、不可被客户端指定）**方向相反**；OTel 全量引入在无 Collector 部署里与 Pino 形成双轨输出。
- v4 时代 Fastify 默认信任客户端 request-id 头的行为不可外推到本仓库（v5 默认 false，本地源码核实）。

## 4. 来源清单（全部 2026-11-07 在线读取；逐条 URL 见各原始笔记 §5/§来源清单）

- Stripe：docs.stripe.com error-handling / idempotent_requests / error-low-level / dashboard request-logs / teams roles；support.stripe.com request log retention；实测 curl api.stripe.com（15:43–15:44 UTC）。
- GitHub：docs.github.com REST getting-started（X-GitHub-Request-Id 示例 + CORS expose）/ Copilot troubleshooting（支持流程）。
- GitLab：docs.gitlab.com administration/logs/tracing_correlation_id；源码 gitlab-org/labkit（correlation/inbound_http.go 等）、labkit-ruby、gitlab workhorse main.go:125、rails actionpack request_id.rb。
- AWS：docs.aws.amazon.com apigateway（access-logging/execution-logging/set-up-logging/http-api-logging/http-api-parameter-mapping）；re:Post knowledge-center（AWS OFFICIAL）extended request IDs。
- Cloudflare：developers.cloudflare.com fundamentals/http-headers（Oct 28, 2026）、cloudflare-ray-id（Oct 15, 2026）、logs/logpush（Oct 30, 2026）、logpush API（Oct 27, 2026）、logpull（Aug 14, 2026）、observability log-explorer（Nov 3, 2026）、analytics GraphQL 教程。
- Fastify/Pino：fastify.dev docs（Server/Request/Logging/Hooks/v4 Server/Migration-Guide-V5）；pino docs（api/redaction/transports/benchmarks）；本地 node_modules 源码（fastify@5.8.5、pino@10.3.1、@pinojs/redact@0.4.0）。
- OWASP/W3C/OTel：cheatsheetseries.owasp.org（Logging/Authorization）；w3c.org TR trace-context（REC 2021-11-23）+ trace-context-2（CR Draft 2024-03-28）；opentelemetry.io（concepts/specs/performance）。

未证实项（如实）：Stripe 200 响应携带 Request-Id 未实测（无有效密钥）；GitHub 内部日志检索机制无官方文档；OWASP 页面无版本日期；OTel 无官方性能百分比数字。
