# Observability Workflow Audit — 现实审计综合（REALITY）

> 合成自 8 组分块审计（A1–A8）。本文是唯一事实文档：每条结论标注证据与等级。
> 证据等级口径：
> - **CODE_VERIFIED**：直接读源码/配置/文档钉死（含行号引用）；
> - **MEASURED**：本次或分块审计中实际执行命令/测试/探针所得输出；
> - **INFERRED**：由已验证事实推导、未经直接测量；
> - **UNKNOWN**：本审计无法验证，禁止当作事实使用。
>
> 未标注"本次合成复核"的行级证据来自分块审计（ask 提供）；标注者为本合成会话在同一 commit 上复跑的抽查。分块审计中【MEASURED】的测试/探针执行记录见 §0.2。

## §0 基线

### §0.1 审计对象与工作树

- 审计工作树 `/home/hoo/Source/exam-otel-audit`，分支 `perf/otel-workflow-attribution`，HEAD=`1d689b4a`；主工作树 `/home/hoo/Source/exam` 同 commit `1d689b4a`（master）。【MEASURED｜本次合成复核：`git -C <树> rev-parse HEAD` 两树同值 `1d689b4a2db3501810bfbfeb7b1a7c7c88c0cc65`；审计树 status 干净】
- HEAD 即 merge commit `1d689b4a`（"fix(telemetry): stop retaining sql.begin scoped handler closures (#994)"，merge `f93e07ce`）。【MEASURED｜`git show 1d689b4a --stat`：5 files, +361/-7】
- SDK 依赖源码验证使用主工作树已安装 node_modules（只读）。审计树 `out/` 为空（`ls out/ | wc -l` → 0），W2.2/W7.1/W7.2 历史 perf JSONL 不在该树。【MEASURED｜本次合成复核】
- 禁改约束已遵守：未触碰 `/home/hoo/Source/exam` 主工作树与 `exam-fix-otel-scoped-handler-retention` 工树的任何文件。

### §0.2 分块审计中的运行验证（已执行，非本会话复跑）

3 组、45 个测试全部通过【MEASURED｜分块审计执行 vitest，主工作树同一 commit】：
1. `pnpm vitest run src/telemetry/serverTelemetryWiring.structural.test.ts src/telemetry/telemetrySignals.test.ts` → 22 passed；
2. `pnpm vitest run src/telemetry/backgroundLoopSpans.test.ts` → 13 passed（真实 PostgreSQL，testing.md §2.8 契约内测试库）；
3. `packages/otel-drizzle-postgresjs` `pnpm vitest run src/otelDbTelemetry.test.ts` → 10 passed。

本合成会话未运行任何测试套件；本会话只做了只读抽查（git/grep/sed/find，见各节"本次合成复核"标注）。

### §0.3 治理边界（来自权威摘要，ask 提供）

- **ADR-028 状态 PROPOSED**（`docs/adr/ADR-028-opentelemetry-technical-telemetry.md:5`）：未接受前不构成施工授权、不改变现行契约；ADR 接受与生产启用是 Owner 分别裁决。已施工实现（W1–W6，PR #973–#980 merged）与 runbook 均以其为边界依据——治理悬置。【CODE_VERIFIED】
- **生产启用裁决 NO_GO**：W7 fixed-stack 复测 On/no-export CPU 中位 +10.4%、On/full-OTLP 中位 +9.1%，双双超 ≤5% 预算（PR #980 body，PR 记录非本会话实测）。
- **默认 Off**（D1）；**预算是验收预算**（ADR-028 §3 表三 :93-104）；**日志单路**（Pino 唯一入口，禁止双路摄入）；**身份权威不转移**（D2，server-owned requestId 权威）；**隐私**（D4，遥测默认排除 raw SQL/参数/原始 URL/凭据）。

---

## §1 A1 代码版本与依赖清单

| 结论 | 等级 | 证据 |
| --- | --- | --- |
| OTel 版本组在 `apps/api/package.json` 精确锁定：`@opentelemetry/api@1.10.0`、sdk-trace/sdk-metrics/context-async-hooks/core/resources `3.1.1`、instrumentation/instrumentation-http/exporter-{trace,metrics}-otlp-http `0.301.2`、instrumentation-pino `0.71.0`、`@fastify/otel@1.0.1`；`@exam/otel-drizzle-postgresjs` 以 workspace:* 引入并自带 api@1.10.0 + sdk-trace/sdk-metrics/context-async-hooks@3.1.1 | CODE_VERIFIED | `apps/api/package.json:35,41,47-57,59,73`；`packages/otel-drizzle-postgresjs/package.json:32-40` |
| 实际安装版本逐包实测一致（api=1.10.0、sdk×5=3.1.1、instrumentation/exporter×4=0.301.2、pino=0.71.0、fastify-otel=1.0.1） | MEASURED | 分块审计：逐包 grep node_modules package.json `"version"` |
| `@fastify/otel@1.0.1` 内部依赖 `@opentelemetry/instrumentation` 解析为 **0.300.0**，与直依赖的 0.301.2 共存于同一依赖树（单 `@opentelemetry/api` 实例）；pnpm-lock 含两条 instrumentation 版本条目 | CODE_VERIFIED | `pnpm-lock.yaml:6201-6205`、`:1766/:1772` |
| 传输边界契约：SDK 不经 `@opentelemetry/sdk-node` 装配，仅导入 OTLP/HTTP exporter；gRPC/Zipkin/Prometheus/B3 家族不进依赖闭包；structural test 断言源码不含 sdk-node/NodeSDK | CODE_VERIFIED | `apps/api/src/telemetry/sdkBundle.ts:19-28`；`serverTelemetryWiring.structural.test.ts:101-103` |
| `sdkBundle.ts` 是全工作区唯一静态导入 OTel SDK 包的模块，只能经 `runtime.ts` 内 `startSdk` 的动态 `import("./sdkBundle.js")` 到达 | CODE_VERIFIED | `sdkBundle.ts:1-7`；`runtime.ts:350` |

**风险**：instrumentation 0.300.0（@fastify/otel）与 0.301.2（SDK 代）跨次版本共存依赖单 API 实例——注释称 probe 实测无冲突，但仓库内无该 probe 的可重复执行证据文件。

**遗留疑问**：`sdkBundle.ts:15-17` 引用的 W1.1 co-run probe 原始测量产物未定位验证。

---

## §2 A2 生产入口与启动顺序

- 容器入口唯一：`docker-entrypoint.sh:43` `exec node dist/server.js` → `apps/api/src/server.ts` 的 `main()`（`server.ts:221-224` 自捕获退出）。【CODE_VERIFIED】
- 启动顺序（全部 CODE_VERIFIED，行号见括号）：`loadRootEnv()`(:44) → `getRuntimeConfig`(:46) → **`initTelemetry()`(:132，在 Fastify 实例构造之前；INVARIANT 注释 :125-131——fastify 5.8.5 在构造器内懒加载 pino，必须先 init 才能让 instrumentation-pino 的 require-hook 在 pino 加载前打补丁，否则关联字段静默消失；`runtime.ts:73-81`)** → `Fastify({...})`(:133-154：genReqId=randomUUID :137、requestIdHeader:false :139、redact+serializers :140-148、trustProxy :153) → `setupRequestIdHeader`(:160) → **若 telemetry On：`telemetry.fastifyOtelPlugin` 作为第一个插件注册**(:167-169，先于 cookie/CORS/全部路由) → 其余插件链(:171-190) → OpenAPI docs(:192) → apiSurfacePlugin 前缀 /api(:198) → 静态前端或 root 404(:200-215) → `registerShutdownSignals`(:217) → `app.listen`(:218)。
- OTel 装配全部位于 `initTelemetry`→`startSdk`（`runtime.ts`）：Off 时早返回 null(:207-208)；On 时钉 `OTEL_*_EXPORTER=none`(:346-348) → 动态 import sdkBundle(:350) → scrub 链(:360-363) → BatchSpanProcessor(:366-385) → startMetrics 仅 otlp(:386-393) → startTracing 注册序 instrumentations→contextManager→propagator→tracerProvider（`sdkBundle.ts:262-270`）→ DB 插件在 SDK 起后、Fastify 实例存在前装(:413-427)。SDK 构造失败 → stderr `telemetry.init_failed`（endpoint 脱敏）→ 进程终身 Off(:210-228)。【CODE_VERIFIED】
- 关机顺序：SIGINT/SIGTERM → auditWrites.stopAccepting → app.close → drainAuditWrites → `shutdownTelemetry`（最后、best-effort、单一 3s 共享 deadline race、never-throw、不改 exit code；trace/metric 两 face 并行互不取消，`runtime.ts:326-337`）。【CODE_VERIFIED；顺序由结构测试钉住 + structural test 17 passed MEASURED】
- 接线契约由静态结构测试验证：init 先于 Fastify 构造、span-owner 插件最先注册、scrub 顺序、sdk-node/ESM loader 禁用、DB 插件仅 On 动态 import、@fastify/otel 唯一 HTTP owner、pino disableLogSending——17/17 通过。【MEASURED｜`serverTelemetryWiring.structural.test.ts:49-104` 等运行输出】

**风险**：ADR-028 PROPOSED 使启动顺序/信号面合同的规范效力悬置（§0.3）。

---

## §3 A3 遥测运行态

### §3.1 Off（TELEMETRY_ENABLED=false）实际加载面与每请求剩余路径

- Off 判定：`settings.ts:834,175` truthyLeaf（unset/empty=false）；`initTelemetry` 在 `config.enabled=false` 时 return null（`runtime.ts:202-208`），发生在任何 SDK 模块加载之前。【CODE_VERIFIED】
- **Off 态唯一静态加载的 OTel 面：`@opentelemetry/api` facade，且生产代码只允许两个模块静态导入它**——`businessOperationSpan.ts` 与 `backgroundLoopSpan.ts`，structural test 钉死（`serverTelemetryWiring.structural.test.ts:204-218`）。【CODE_VERIFIED｜本次合成复核：grep 全 src 的 `@opentelemetry/api` import——值导入仅上述两文件（`businessOperationSpan.ts:1-7`：SpanStatusCode+trace；`backgroundLoopSpan.ts:1`：metrics+SpanStatusCode+trace）；`boundedMemorySpanExporter.ts:1`、`exceptionScrubSpanProcessor.ts:1`、`urlScrubSpanProcessor.ts:1`、`serverRootPropagator.ts:1-6` 均 `import type`（编译期擦除）；`sdkBundle.ts:37` 值导入但该模块仅经动态 import 到达】
- `@exam/otel-drizzle-postgresjs`（含 driver 原型 patch）Off 态完全不被加载：唯一引用是 `startSdk` 内动态 import（`runtime.ts:415-417`），structural test 断言无静态 import 且位于 bundle.startTracing 之后（`serverTelemetryWiring.structural.test.ts:140-164`）。【CODE_VERIFIED】
- 运行时探针（Off 进程真实行为）：startActiveSpan 返回 NonRecordingSpan 且 isRecording=false、body 正常透传；trace.getTracerProvider()=ProxyTracerProvider（无 delegate）；metrics.getMeterProvider()=NoopMeterProvider、histogram.record 无操作；propagation.inject 零 key。【MEASURED｜分块审计 node 探针 /tmp/otel-off-probe.mjs，依据 api dist ProxyTracer.mjs:27-33、NoopTracer.mjs:17-36、NoopContextManager.mjs:8-10、api/metrics.mjs:29-30】
- Off 态加载 facade 不产生 globalThis 注册：`globalThis[Symbol.for("opentelemetry.js.api.1")]` 不存在，零全局注册。【MEASURED｜同探针；依据 api dist internal/global-utils.mjs:13-21】
- Off 态每请求剩余 OTel 调用路径：仅 0-N 次 `withBusinessOperationSpan` 门面调用（全仓 9 个调用点，其中 **8 个在请求路由**：`attempts.candidate.ts:716,904,1055,1279,1409`、`attempts.admin.ts:209,303`、`gradingQueue.ts:380`——该调用点在路由处理器内（`gradingQueue.ts:375-377` 路由注释为证）；后台 1 个：`deadlineScanner.ts:227`）→ ProxyTracer.startActiveSpan → NOOP_TRACER：约 1 个 NonRecordingSpan + 1 个 setSpan Context 分配 + NoopContextManager.with 直通。零 patch、零队列、零定时器、零网络；ContainedSpan 的逐调用 try/catch 仍执行（纯内存）。【CODE_VERIFIED｜本次合成复核：`grep -c withBusinessOperationSpan(` 生产调用点=9】
- Off 态 DB 层零 OTel：`executeInTransaction` 读 `getTransactionSeam()`=null → 直通（`packages/db/src/types.ts:226,246-248,275`；本次合成复核 grep 确认 :226 `const seam = getTransactionSeam();`）；`db.ts:41` 的无条件注册调用经 `active?.dbTelemetry?.` 可选链 no-op（`runtime.ts:152-156`）。`packages/db` 全目录零 `@opentelemetry` 引用。【CODE_VERIFIED｜本次合成复核 grep 输出为空】
- Off 态 `@fastify/otel` 插件不注册（`server.ts:162-169` `if(telemetry)` 守卫）、Http/Pino instrumentation 不注册；后台循环每 settled cycle 付一次 withLoopCycleSpan NOOP 调用 + memoized NOOP instrument record（4 个调用点：`heartbeat.ts:359`、`clientEventRetention.ts:118`、`emailOutboxLoop.ts:135`、`deadlineScanner.ts:404`）。【CODE_VERIFIED】

**风险**：Off 并非"零模块加载"——`@opentelemetry/api` 随路由模块静态加载（facade 无 provider 即惰性 NOOP），该包始终在启动模块图中。
**遗留疑问**：`runtime.ts:47` 引用的 W1.1 Off-state 测量为历史 probe 结论，未复测真实进程网络面。

### §3.2 exporter=none/memory/otlp 三态 Provider 差异

- **共同面**：`startSdk` 先把三 OTEL_*_EXPORTER 显式钉 none 再动态 import（`runtime.ts:346-348`）；三态均调用 `startTracing`，注册完整 TracerProvider（resource 含 service.name、ParentBased(TraceIdRatioBased(sampleRatio))、给定 spanProcessors）+ AsyncLocalStorageContextManager + 全局 propagator + instrumentations——**instrumentations 仅 Http（incoming-disabled）与 Pino 两个，`@fastify/otel` 不经 startTracing**：它在 `runtime.ts:429` 经 `bundle.createFastifyInstrumentation()` 构造、`:442` 以 `fastifyOtelPlugin` 返回、由 `server.ts:167-169` 注册为第一个 Fastify 插件（`runtime.ts:396-406`；`sdkBundle.ts:249-270`——startTracing 注册序 instrumentations→ALSCM→propagator→tracerProvider）。【CODE_VERIFIED｜本次合成复核：读 `runtime.ts:339-400` 全段确认三分支、读 `runtime.ts:396-406` 确认 instrumentations 数组仅 Http+Pino、读 `runtime.ts:429,442` 确认 fastify-otel 的构造/返回点】
- **exporter=none**：spanProcessors 仅 [UrlScrub, ExceptionScrub]、无 exporter、flush=null——**span 仍被完整记录**（SpanImpl+属性存储）并在 onEnd 被 scrub 后直接丢弃；**不注册 MeterProvider**（`metricsSdk=null`，`runtime.ts:360-364,365,436-439`；`sdkBundle.ts:171-178` MeterProvider 仅在 startMetrics 创建）。即 none 不是"空 provider"，是全量记录无导出；facade meter=NOOP。【CODE_VERIFIED】
- **exporter=memory**：仅 trace 面增加 BSP(BoundedMemorySpanExporter, 界 2048/5s/30s/512) 与 flush=batch.forceFlush（`runtime.ts:352-371`）；**metricsSdk 仍为 null → 无 MeterProvider，无真 Metric 聚合**——memory 模式只有 span 见证（ring 1000 spans、每 span ≤16 events、export 同步永不失败，`boundedMemorySpanExporter.ts:44,51,73-88`）。【CODE_VERIFIED】
- **exporter=otlp**：trace 面换 OTLP BSP(endpoint+"v1/traces")；metric 面 `startMetrics` 注册全局 MeterProvider + 单一 PeriodicExportingMetricReader(endpoint+"v1/metrics", 60s/30s)（`runtime.ts:373-394`；`sdkBundle.ts:120-122,132-145,167-179`）——**仅此态 facade instruments 变为真序列**。LoggerProvider 任何模式都不存在（grep 生产源码零 LoggerProvider；`sdkBundle.ts:32-35` log face stays absent）。【CODE_VERIFIED】
- 配置交叉叶子：otlp 与 endpoint 必须成对（缺一抛 RuntimeConfigError），endpoint 必须绝对 http(s)、无凭据、无 query/fragment（`runtimeConfig.ts:776-831`）；配置错误在 `initTelemetry` 读 `getRuntimeConfig()` 时 fail-fast（该调用在 try 外，`runtime.ts:207`）。【CODE_VERIFIED】

**风险**：On+none 仍付全量 span 记录成本——语义是 "On-but-no-export" 而非低开销态，运维以 none 估开销需知此点。

### §3.3 SDK 生命周期（init/degrade/shutdown）

- init 一次性且终态：`active/initAttempted` 模块级标志；重复 init 返回同一 handle；degraded/Off/shutdown 后 init 返回 null（api dist global-utils.mjs:23-27 duplicate-registration 错误证实 OTel API 单向注册）；SDK 运行时失败 → stderr `telemetry.init_failed` → 进程降级 Off。【CODE_VERIFIED｜`runtime.ts:133-134,190-204,210-228,238-244`】
- DB 插件安装降级独立包含：`installOtelDbTelemetry` 抛错 → `dbTelemetry=null` + `setTransactionSeam(null)` + stderr `telemetry.db_init_failed`，其余遥测存活（ADR-028 D1）。【CODE_VERIFIED｜`runtime.ts:413-427`】
- shutdown 顺序与界：app close 后（成功与失败路径）`await shutdownTelemetry()`（#351 预算内 best-effort）；内部先 `dbTelemetry.disable()`（还原原型，#974/#994 链）再 `setTransactionSeam(null)`，随后单一 3s 共享 deadline race（`SHUTDOWN_FLUSH_TIMEOUT_MS=3000`）：memory 先 flush 后写 dump JSONL（appendFileSync best-effort），`sdk.shutdown` 经 `composeSdkShutdown`（Promise.allSettled，一 face 失败不取消另一 face）。永不抛、不改 exit code、terminal。【CODE_VERIFIED｜`server.ts:78-84`；`runtime.ts:94,253-315,326-337,449-460`；`driverStatementSeam.ts:122-132`；structural test :166-174（17 passed MEASURED）】
- `flushRetainedSpansForDiagnostics`（测试/诊断面）与 shutdown 同构：无 flush 直接返回，否则 Promise.race 3s、catch 吞 flush 失败。【CODE_VERIFIED｜`runtime.ts:173-186`】

**风险**：3s deadline 到期后直接放行未完成的 `sdk.shutdown()`——若 OTel 内部任务仍持有引用，依赖 server.ts 的 2s bounded exit assist 兜底。

---

## §4 A4 插桩语义

### §4.1 SpanProcessor 链、批处理界、上下文传播

- Processor 链恒为 [UrlScrub, ExceptionScrub] 前置 + 按 exporter 追加 BSP（memory/otlp 才有）；MultiSpanProcessor 按序同步依次 onEnd，scrub 后形态是导出唯一形态；structural test 钉死 url-scrub 第一、exception-scrub 第二且先于任何 queueing processor。【CODE_VERIFIED｜`runtime.ts:355-371`；sdk-trace dist MultiSpanProcessor.mjs:34-37；`serverTelemetryWiring.structural.test.ts:106-130`】
- 批处理界以常量显式传入 BSP（非默认侥幸）：2048/5000/30000/512；metric reader 60s/30s；BSP 定时器与 metric interval 均 unref。【CODE_VERIFIED｜`runtime.ts:100-114`；本次合成复核：安装版 `BatchSpanProcessorBase.mjs:24-27` 默认值恰为 512/2048/5e3/3e4，常量传入值与之一致】
- 上下文管理器：AsyncLocalStorageContextManager；注册序 instrumentations→contextManager→propagator→tracerProvider（复刻 sdk-node 序）。【CODE_VERIFIED｜`sdkBundle.ts:262-270`】
- 传播：全局 propagator = ServerRootPropagator 包 Composite(W3CTraceContext+W3CBaggage)；**extract 恒等返回调用方 context（入站 traceparent/baggage 永不采信）**，inject/fields 全量 W3C 出站。【CODE_VERIFIED｜`serverRootPropagator.ts:22-51`；`sdkBundle.ts:187-195`】
- HTTP SERVER span 单一 owner 装配：HttpInstrumentation `disableIncomingRequestInstrumentation:true`（只留 outbound）、`@fastify/otel` `instrumentHooks:false`、Pino `disableLogSending:true`。【CODE_VERIFIED｜`sdkBundle.ts:197-234`；structural test :221-229】⚠️ 附注：**"每请求收敛为 request root + handler 两个"、"默认 true 约 8 spans/请求" 是 W1.1 probe 历史数字（未复测，仓库内亦无测试断言每请求 handler-span 数量——`telemetrySignals.test.ts:159-167` 只钉 error 路径恰 1 个 root server span、:180-206 只钉 pino 关联），属 INFERRED（历史探针记录），不随 flag 的 CODE_VERIFIED 一并成立**（→ §4.3 遗留疑问、§10 E7/E9）。

**风险**：ParentBasedSampler 的 remoteParentSampled=AlwaysOn 分支因 ServerRootPropagator 拒绝入站 parent 而对 HTTP 不可达；但未来直接用 `propagation.extract` 的代码路径会绕过该防线（静态推演，INFERRED）。

### §4.2 TELEMETRY_SAMPLE_RATIO 源码语义

- 解析：严格 [0,1] 闭区间、允许小数、越界/非数值抛 SettingsError fail-fast（不 clamp）；默认 1；"采样只缩量、不缩身份"。【CODE_VERIFIED｜`settings.ts:419-452,836-838`】
- 装配：ratio 仅喂 ParentBasedSampler 的 root 决策；TraceIdRatioBasedSampler(0) → 全部 NOT_RECORD；Tracer.startSpan 对 NOT_RECORD 在构造 SpanImpl 之前 return NonRecordingSpan——属性不入 store、processor onStart/onEnd 不触发、BSP 永不见。【CODE_VERIFIED｜`sdkBundle.ts:256-259`；sdk-trace dist TraceIdRatioBasedSampler.mjs:10,13,22-34；Tracer.mjs:70-75；BatchSpanProcessorBase.mjs:46】
- **0 仍付插桩成本**：NOT_RECORD 之前已执行 cleanAttributes（属性清洗）、shouldSample（32 次 charCodeAt 累加）、_tracerMetrics.startSpan；startActiveSpan 随后仍 setSpan + context.with（AsyncLocalStorage 进出）。子 span 经 ParentBased 本地未采样分支同为 NonRecordingSpan。业务面逐次 ContainedSpan.setAttribute（no-op 但调用发生）与 outcome/status 写入照旧。【CODE_VERIFIED｜sdk-trace dist Tracer.mjs:60-75,96-113；ParentBasedSampler.mjs:22-35；`businessOperationSpan.ts:100-126,171-183`】

**风险**：以 `SAMPLE_RATIO=0` 为"性能逃生口"节省有限——PR #980 实测 ratio=0 无 CPU 改善（开销在 plumbing 而非 span 量，见 §8.2）。

### §4.3 高频路径重复操作与跨类型 attribute 写入

- **跨类型无意义 attribute 写入（确证）**：`UrlScrubSpanProcessor.onEnd` 对每个结束的 span 无条件写 `url.path`——route 模板或 `"(unrouted)"` 占位（常量定义 `urlScrubSpanProcessor.ts:35`）。db.statement、db.transaction(.attempt)、business、loop 等 **100% 非 HTTP span 全部获得 `url.path="(unrouted)"`**，是对语义约定键的无意义跨类型写入并轻微增大 attribute 体。【CODE_VERIFIED｜本次合成复核：读 `urlScrubSpanProcessor.ts:62-74`——`attributes[URL_PATH_KEY] = typeof route === "string" && route.length > 0 ? route : UNROUTED_SPAN_PLACEHOLDER`，无类型/存在性判别】
- scrub 常数工作无重复：每 span end = url scrub（4 键删除 + http.route 读 + 1 写）+ exception scrub（4 键删除 + status.message 检查 + 逐 event 4 键删除）；spanProcessors 数组只传一次 → 单 MultiSpanProcessor。【CODE_VERIFIED｜`urlScrubSpanProcessor.ts:17-22`；`exceptionScrubSpanProcessor.ts:80-98`；sdk-trace TracerProvider.mjs:11-13】
- DB 高频路径每语句恰好一次观察：seam 五个 thenable 包装只在 `!executed` 首次消费时 consult；settle watch 是已提交 Query 上单条 native then 多路复用；每语句 = 1 span + 2×performance.now + 1 Promise.then + 诊断计数。【CODE_VERIFIED｜`driverStatementSeam.ts:179-200`；`packages/otel-drizzle-postgresjs/src/index.ts:227-296`】
- 事务路径 context 操作各一次：logical/attempt 各一次 startSpan + setSpan + context.with；语句 span 不做 context.with；retry event 读 active span 加 event——无重复包裹。【CODE_VERIFIED｜`transactionSeam.ts:97-124,179-193`】
- facade memoization 正确：loop instruments 首次 settle 后缓存（instrumentsBroken 终态降级）；ProxyTracer 每次调用重查 delegate 是 Off→On 演进正确性的必要重查询，非缺陷。【CODE_VERIFIED｜`backgroundLoopSpan.ts:66-102`；`businessOperationSpan.ts:74-76`；api dist ProxyTracer.mjs:19-33】
- 业务 span 失败路径双重 outcome 写入（provisional success → classifyThrown 覆盖）语义上必要，非重复缺陷。【CODE_VERIFIED｜`businessOperationSpan.ts:171-183`】

**风险**：`url.path="(unrouted)"` 若被下游 collector/分析按 url.path 聚合，会把全部 DB/业务 span 归入同一伪路由桶；attribute ~22B/span 常量放大。
**遗留疑问**：W1.1 probe F2（raw request.url→url.path）与 F6（默认 8 spans/请求）为注释引用的历史测量，未复测。

### §4.4 #994 WeakSet scoped handler 修复在 master 的验证

**结论：修复在位（已三层实证）。**【MEASURED｜本次合成复核】

1. **Git 层**：HEAD `1d689b4a` 是 merge `f93e07ce`（"fix(telemetry): stop retaining sql.begin scoped handler closures"）的 merge commit；`git show f93e07ce -- packages/otel-drizzle-postgresjs/src/index.ts` diff 显示 `const scopedClosures = new Set<unknown>()` → `new WeakSet<object>()`，新增 `canHoldWeakReference` 守卫与 handler 本地变量提取。【MEASURED｜本次合成复核命令与输出】
2. **工作树源码层**：master 工作源码 `packages/otel-drizzle-postgresjs/src/index.ts:190` `const scopedClosures = new WeakSet<object>();`、`:223` `canHoldWeakReference` 定义、`:234` 守卫 `canHoldWeakReference(handler) && !scopedClosures.has(handler)`。【CODE_VERIFIED｜本次合成复核 grep】
3. **语义层**：rootClosures 保持强 Set（每注册 root pool 一条、每进程一池、有界）；scopedClosures 弱集（postgres.js 每 sql.begin/savepoint scope 造新 handler 闭包，强 Set 将进程级保留每完结事务的闭包链）；`observeStatement` 以 guard + WeakSet 做 first-sight 去重计数，语义与修复前一致。【CODE_VERIFIED｜`index.ts:177-190,223-240`】
4. **回归证据链**：`scopedClosureRetention.test.ts`（+271 行，WeakRef+--expose-gc 可回收性）与 `otelDbTelemetry.test.ts`（+25 行去重/分类）随 merge 进入 master；commit message 记录 pre-fix 0/8 → post-fix 8/8 可回收、300tx×64KB 探针 30/30 → 0/30 存活、external 13.7→23.6MB 变 2.59MB 持平；per-op 性能 delta 标注 INCONCLUSIVE。【MEASURED｜git show --stat；测试文件存在于 master；commit message】

**未执行项**：本审计未运行 `scopedClosureRetention.test.ts`（需真实 PG + `--expose-gc` harness）；回收性结论引用 commit message 与测试文件存在性，非本次执行。

### §4.5 Exporter 故障（拒绝/超时）的内存、队列与丢弃路径

- **BSP 队列满即丢、无背压**：`_finishedSpans` 达 2048 时 `_addToBuffer` 直接丢弃并计数（`_droppedSpansCount++` + `this._metrics.dropSpans(1)`），首个成功入队时补 diag.warn。【CODE_VERIFIED｜本次合成复核：读安装版 `sdk-trace@3.1.1/dist/export/BatchSpanProcessorBase.mjs:63-76`】
- **导出失败/超时批次永久丢失（不回队）**：`_flushOneBatch` 先把整批 splice 出队列再 export（:102-104）；export 回调 FAILED → reject（:109）→ 定时 flush 路径 catch 后 globalErrorHandler；BSP 30s exportTimeout 与 exporter 端 10s 默认 timeout 双层界。【CODE_VERIFIED｜本次合成复核：同文件 :96-110；otlp-exporter-base dist shared-configuration.mjs:24（timeoutMillis 1e4）；http-transport-utils.mjs:75-81（setTimeout→req.destroy→retryable）】
- **OTLP 内部重试有界**：RetryingTransport MAX_ATTEMPTS=5、退避 1s 起 ×1.5 封顶 5s ±20% jitter；retryable = HTTP 429/502/503/504 + ECONNRESET/ECONNREFUSED/EPIPE/ETIMEDOUT/EAI_AGAIN/ENETUNREACH/ENOTFOUND；响应体超 4MB 非重试并 destroy。【CODE_VERIFIED｜本次合成复核：`otlp-exporter-base@0.301.2/dist/retrying-transport.mjs:3`（`const MAX_ATTEMPTS = 5`）；is-export-retryable.mjs:3-5；http-transport-utils.mjs:14-19,115-124】
- **关键包含缺口：失败在应用层完全不可见**——本运行时从不安装 diag logger（`sdkBundle.ts:244-248` 注释明确不装；grep 生产源码 `diag.setLogger|setGlobalErrorHandler` **0 命中**【本次合成复核】），api dist diag.mjs:20-24 无 logger 时静默返回，core 默认 loggingErrorHandler 只调 diag.error——exporter 失败/队列丢弃/重试耗尽无 stdout/stderr 信号。【CODE_VERIFIED】
- **BSP 丢弃计数不可读**：`dropSpans` 指标接入的是 selfObsMeterProvider——本运行时未传该选项（构造处仅 `{exporter, ...BATCH_QUEUE_BOUNDS}`），自观测 meter 恒为 createNoopMeter，丢弃量应用侧不可读。【CODE_VERIFIED】
- memory exporter 故障面为零：export 同步 SUCCESS、shutdown 清 buffer、forceFlush no-op。【CODE_VERIFIED｜`boundedMemorySpanExporter.ts:56-67,73-95`】
- metric 面（仅 otlp）故障包含在 reader 内：`_runOnce` 捕获一切 → globalErrorHandler（被吞）；`_ongoingExportPromise` 守卫跳过并发轮；单批 30s 超时 break；60s interval unref 继续——失败只丢当轮 points。【CODE_VERIFIED｜sdk-metrics dist PeriodicExportingMetricReader.mjs:60-109；`runtime.ts:107-114`】
- 关闭期有界：3s 共享 deadline race + allSettled + 定时器 unref，绝不延长 #351 退出预算。【CODE_VERIFIED｜`runtime.ts:271-315,326-337`；BatchSpanProcessorBase.mjs:154-157；PeriodicExportingMetricReader.mjs:106-109】

**风险**：OTLP collector 假死（accept-but-never-answer）运行态完全静默（无 diag + metric 60s 一次 + trace 批次 30s 后静默丢弃）；collector 单端口故障同时打击 trace 与 metric 两 face（互不取消但无告警面）。建议后续把 globalErrorHandler 桥到 pino warn 作最小自观测。
**遗留疑问**：未做真实 collector 故障注入（只读审计）；故障注入既有结论见 §8.2/§0.3（OTLP unreachable/500-reject/35s slow-read/blackhole ×4 各 6000 请求：业务结果/readiness/关机语义不变——PR #980 记录）。

---

## §5 A5 DB 插桩包（@exam/otel-drizzle-postgresjs）

### §5.1 patch 面与每条语句成本

- patch 面恰为 postgres.js Query.prototype 5 个方法：then/catch/finally/execute/forEach（wrapper 与转发 `driverStatementSeam.ts:179-200`；apply/restore 纯值交换 :103-113/:122-132；install 单次捕获 pristine :143-203）。【CODE_VERIFIED】⚠️ 附注：install 取原型用的 marker client（`postgres("postgres://127.0.0.1:1/none")`，`driverStatementSeam.ts:146-149`）"创建即弃、不拨号" 仅有代码注释 + Query 惰性静态推演支撑，**无可执行钉子**（W2.1 probe 文档缺失、无测试断言不发起连接）——该子句 INFERRED，运行级确认 UNKNOWN（→ §9 第 10 项）。
- 5 个方法正是 postgres.js 3.4.9 中唯一把懒 Query 翻转为已提交的消费入口；cursor() 经 execute() 进入；raw()/values() 仅置标记；cancel/simple/readable/writable/describe/stream 均未包。【CODE_VERIFIED｜postgres cjs/src/query.js:123,139-161（主仓 node_modules，lockfile 钉 3.4.9 `pnpm-lock.yaml:4639`）】
- 运行时探针：5 方法均为 own、writable=true、configurable=true 的 function 数据属性——逐属性值交换恢复契约成立。【MEASURED｜分块审计 node 探针（未连库）】
- 每条提交语句 submission 侧成本：observer 同步一次（诊断计数 + rootClosures.has + WeakSet has/add + byRole）、startSpan 一个 CLIENT span 带 2 键属性、performance.now×1、`Promise.prototype.then.call` 挂 2 个每语句 settle 闭包。【CODE_VERIFIED｜`index.ts:227-296`（尤其 243-250,260-295）】
- settle 侧成本：performance.now×1、setAttribute(outcome)、错误路径 setAttribute(sqlstate)+setStatus(ERROR)、recordStatementDuration 标签对象构造 + histogram.record、span.end()。【CODE_VERIFIED｜`index.ts:200-215,262-294`】
- metric 恰每 settle 一条：直方图 `db.client.operation.duration`（单位 s，bucket 0.001..10），install 时创建一次；标签 db.system / exam.db.connection.role / exam.db.outcome（错误再加 db.response.status_code）。【CODE_VERIFIED｜`index.ts:161-175,200-215`；`vocabulary.ts:29-30,54-56`】
- wrapper 每消费调用额外付 rest-args 数组 + apply（then/catch/finally）；execute/forEach 定参无数组。【CODE_VERIFIED｜`driverStatementSeam.ts:180-199`】
- seam 从不读 q.strings/q.args（语句文本与参数不入 span）；属性闭集 ALLOWED_ATTRIBUTE_KEYS 钉住。【CODE_VERIFIED｜`driverStatementSeam.ts:52-61`；`testHelpers.ts:99-107`】
- drizzle-orm 0.45.2 自带 OTel 追踪在发行版中是死代码：探针 startActiveSpan 回调收到 span=undefined（惰性短路）；发行 js 无 `otel =` 赋值；每语句 drizzle 侧成本仅剩回调闭包分配。【MEASURED｜分块审计探针；`drizzle-orm/tracing.js:3-12`；README:129】

**风险**：每语句 ~5-7 次小对象/闭包分配（恒定小开销，见 §5.5）；错误语句 cause 链在同一 settle 内走两遍。

### §5.2 事务/retry seam 与 statement patch 是否重复计量 —— **结论：不重复**

- 两层是不同测量点：statement 层在每个实际提交语句的首个 thenable 消费点开/关 span（时长=submission→settle）；逻辑层只在 `executeInTransaction` 边界包 span——logical 包整个重试循环、attempt 包单次 db.transaction 尝试，retry 循环/退避/隔离级别归 executeInTransaction 所有。【CODE_VERIFIED｜`packages/db/src/types.ts:226-275`；`packages/db/src/observation.ts:50-78`；`index.ts:6-17`】
- 归属不重复：histogram 只在 statement 层；事务/retry 层只有 span+event，无任何事务级 metric（词汇表闭集无 tx metric）。【CODE_VERIFIED｜`transactionSeam.ts:126-194`；`vocabulary.ts:20-30`】
- 嵌套是包含关系非重复记录：语句 span 经 async context 嵌入 attempt 之下（父指针=attempt spanId）；retry 时两个 attempt 互为兄弟；retry 同时表现为逻辑 span 上的 transaction.retry event（与 #800 stdout warn 并列不替代）。【CODE_VERIFIED｜`otelDbTelemetry.test.ts:312-314`；`otelDbTelemetryRetry.test.ts:186-195`；`transactionSeam.ts:6-21,179-193`】
- 多消费者单计数成立：patch 守卫 `if(!this.executed)`（5 wrapper 同构）；postgres.js scope handler 内部 q.catch（index.js:292）发生在 executed 翻转之后故不重计；重复 await 同一 Query 只计一次；基准相位断言 submissions==settles==语句数。【CODE_VERIFIED｜`driverStatementSeam.ts:180-199`；postgres cjs index.js:291-296；`otelDbTelemetry.test.ts:144-147,204-208`；`benchmark.test.ts:210-211`】
- 事务控制语句（begin/set/commit/rollback/savepoint）也被 statement 层计入；S4 模板断言 7 条语句、role root=1/transaction=6、每 sql.begin/savepoint scope 恰 1 个 scoped closure。【CODE_VERIFIED｜`otelDbTelemetry.test.ts:307-324`】
- 直连 db.transaction（绕过 executeInTransaction）只有 statement span、无 logical/attempt span——逻辑层唯一入口是 executeInTransaction。【CODE_VERIFIED｜`otelDbTelemetry.test.ts:327-350`；`types.ts:226`】
- 相邻测量器无冲突：#550 capacity research 仅 CAPACITY_RESEARCH=1 时包根实例 sql.unsafe 计"到达数"，与 otel seam 的"提交数"测量点不同；db.ts 固定先注册 telemetry 后装 research wrapper。【CODE_VERIFIED｜`apps/api/src/plugins/db.ts:33-45`；`apps/api/src/lib/capacityResearch.ts:19-28,52-60`】

### §5.3 每事务/每重试 span 与 metric 清单及归属 scope

- scope 统一 `exam.db`（tracer 与 meter 同 scope；`vocabulary.ts:18`；`index.ts:157-159`；`transactionSeam.ts:197-201`）。【CODE_VERIFIED】
- 每 executeInTransaction：1× `db.transaction` CLIENT span（属性仅 db.system=postgresql）；每尝试 1× `db.transaction.attempt`（db.system、exam.db.tx.attempt 0 起、exam.db.tx.isolation_level ∈ read committed/repeatable read）；每分类重试 1× 逻辑 span transaction.retry event。【CODE_VERIFIED｜`transactionSeam.ts:129-150,152-177,179-193`；`types.ts:246-248,268`；`observation.ts:30-47`】
- 状态语义：重试至成功逻辑 span 保持 UNSET（失败尝试自带 ERROR）；循环整体失败才 ERROR+sqlstate 或 UNCLASSIFIED；无消息文本进 status。40001/40P01 真实场景钉死：恰 1 个 retry event、attempt 0/1、失败 statement span 带 40001。【CODE_VERIFIED｜`transactionSeam.ts:64-71,135-147`；`otelDbTelemetryRetry.test.ts:169-201,212-221`】
- metric 清单仅 statement 直方图一项（成功与失败都记）；事务/retry 无 metric 记录点。【CODE_VERIFIED｜`index.ts:262-294`；`vocabulary.ts:20-30`】
- role 归属：registerRootConnection 经一次性懒 marker query（`sql.unsafe("select 1")`，创建即弃）读根池 handler 存强 Set（每进程 1 池）；其余一切 closure 归 transaction，弱集首见去重。BEGIN 骑根池故 role=root；每 drizzle 事务恰 1 个 scoped closure。"从未消费→从未提交→池上零执行" 有代码注释（`index.ts:300-303`，引 W2.1 §2.2/S3）+ Query 惰性静态复核支撑（postgres@3.4.9 query.js handle() 仅在消费时翻转 executed），但 **"零网络 IO" 无可执行钉子**：W2.1 probe 文档两树均不存在（§11#3）、无测试断言 marker 不拨号——该子句降级 **INFERRED（注释级 + 静态推演），probe 级确认 UNKNOWN**（→ §9 第 10 项）。【CODE_VERIFIED（Set/去重/role 断言）｜`index.ts:177-190,227-241,300-307`；`benchmark.test.ts:213-225`；`scopedClosureRetention.test.ts:118-124`】
- Off 关闭顺序：shutdown 先 `dbTelemetry.disable()`（还原原型）再 `setTransactionSeam(null)`，之后才 flush——结构测试钉死。【CODE_VERIFIED｜`runtime.ts:259-269`；structural test :140-175（MEASURED 17 passed）】

**风险**：`db.response.status_code` 接受任意 `/^[0-9][0-9A-Z]{4}$/` SQLSTATE + UNCLASSIFIED——有界但开放的值域（数百量级），otlp 模式下每个不同 SQLSTATE 是一条独立 metric 流（`vocabulary.ts:8-9` 自称低基数，实为"有界但开放"）。

### §5.4 Off 状态：patch 是否安装、stub 成本

- **Off 安装面为零**：插件模块只经 startSdk 内动态 import 装载，startSdk 仅 config.enabled 时被调——Off 进程连模块都不加载，原型 patch/histogram/seam 均不存在。【CODE_VERIFIED｜`runtime.ts:202-208,339-350,407-427`；structural test :140-162；`settings.ts:844`】
- import≠install 独立反证测试：仅导入本包不 patch 原型、@exam/db seam 保持 null、install 唯一决策且幂等。【CODE_VERIFIED｜`offNoSideEffects.test.ts:29-47`】
- Off 下 DB 路径 stub 成本：每语句 0（原型原生 stock）；每 executeInTransaction 1 次模块变量读 + 3 处 seam? 分支（`types.ts:226,246,268,275`）；每进程 1 次经双可选链 no-op（不创建 marker query）；packages/db 零 OTel 依赖。【CODE_VERIFIED｜本次合成复核 grep packages/db 零 @opentelemetry】
- **On 但非 otlp（缺省 none）**：无全局 MeterProvider → install 拿到的 histogram 是 NOOP 仪器，但 recordStatementDuration **仍每 settle 构造标签对象+条件展开并调 noop record——标签分配纯浪费**；span 真实并流经两个 scrub processor（UrlScrub 给每条 statement span 补 `url.path="(unrouted)"`、ExceptionScrub 删 4 键+重写 status.message）。【CODE_VERIFIED｜`runtime.ts:360-394`；`sdkBundle.ts:167-178`；`urlScrubSpanProcessor.ts:60-74`；`exceptionScrubSpanProcessor.ts:80-98`；`index.ts:200-215`】
- 降级路径（On 内）：meter 损坏→histogram=null 仅 span；tracer 抛错→withSpan 用 noopSpan 继续；观察者抛错→patch 内吞掉语句照常——有真实 PG 测试覆盖。【CODE_VERIFIED｜`index.ts:172-175`；`transactionSeam.ts:74-124`；`otelDbTelemetry.test.ts:468-510`】
- API 侧 Off 加载面：runtime.ts 静态引入的 4 个辅助模块全部 import type（编译期擦除）。【CODE_VERIFIED｜`boundedMemorySpanExporter.ts:1-2` 等】

**未运行项**：offNoSideEffects / lifecycle / retention / benchmark / retry 五个真实 PG 套件本次审计未运行（审计树无 node_modules；相关断言来自读测试代码，CODE_VERIFIED 非执行结果）。

### §5.5 per-statement 高频分配热点

- 成功路径热点清单（全部 plugin 侧）：① span 属性对象字面量（`index.ts:243-249`）；② SDK Span+属性存储；③ 2 个每语句 settle 闭包 + 派生 promise + 2 条 reaction（`index.ts:260-295`）；④ metric 标签对象含条件展开（`index.ts:207-214`，NOOP histogram 时仍分配）；⑤ wrapper rest-args 数组 + apply（`driverStatementSeam.ts:180-191`）；⑥ setAttribute(outcome) SDK 写入。【CODE_VERIFIED】
- 错误路径追加：findPostgresSqlState 每次分配 visited Set（`types.ts:128-130`）；同一失败语句 settle 内被调 2 次（`index.ts:278` 直接 + `:281`→markSpanError 内部再调 `transactionSeam.ts:64-71`）；attempt 层 markSpanError 第 3 次（`transactionSeam.ts:169`）；重试分类 isRetryableError 与 sqlstate find 各再走一遍链并各展开一次 `[...RETRYABLE_ERROR_CODES]`（`types.ts:174-178,254-256`）。**一次 40001 失败尝试 ≈ 5 次 cause 链 walk、5 个 Set、2 个数组展开。**【CODE_VERIFIED】
- 每 attempt/logical 热点（withSpan）：属性对象、context.with 的 context 对象、finish 闭包、async exec 闭包、.finally 派生 promise（`transactionSeam.ts:97-124,129-149,152-177`）；每 retry event 一个属性对象（:183-189）。【CODE_VERIFIED】
- 非热点确认：诊断计数、WeakSet/强 Set 成员判断、performance.now（每语句 2 次）无分配；seam 全程无语句文本/参数/URL/消息序列化。【CODE_VERIFIED｜`index.ts:227-250`；`driverStatementSeam.ts:52-61`】
- 可回收性已结构化：per-tx scoped closure 用 WeakSet（#994）；根 closure 强 Set 有界；recyclability 由 --expose-gc+WeakRef 测试钉死（**未运行**）。【CODE_VERIFIED｜`index.ts:177-190`；`scopedClosureRetention.test.ts:1-32,127-148`】
- 负载锚点：基准固定 400 selects + 40 tx×6 语句（statementCount=640）；CPU/p99 ≤5% 预算属 W7.2 集成验收、本入口只记录不断言。`out/` 证据文件两工作树均不存在。【CODE_VERIFIED｜`benchmark.test.ts:163-225`；本次合成复核 `ls out/` → 0】

**优化候选（INFERRED，量级未测）**：① NOOP histogram（exporter none/memory，即缺省 On 部署）下按 outcome 预建常量标签对象可消除每 settle 标签分配（错误路径 sqlstate 除外）；② 错误语句重复 cause 链 walk 可共享一次 walk 结果，错误路径开销约减半。

**遗留疑问**：分配热点的实际纳秒/字节量级未测（benchmark 需真实 PG + node_modules）；ADR-028 仍 PROPOSED——插件已施工但架构决策未经 Owner 接受。

---

## §6 A6 Span 拓扑与指标

### §6.1 HTTP span owner 唯一性 —— **结论：唯一**

- 唯一 owner：`@fastify/otel@1.0.1` FastifyOtelInstrumentation `instrumentHooks:false`，全仓唯一创建点 `sdkBundle.createFastifyInstrumentation`（`sdkBundle.ts:232-234`【本次合成复核 grep 确认】）；`.plugin()` 经 `runtime.ts:442` 返回，`server.ts:167-169` 注册为第一个插件。【CODE_VERIFIED】
- 第二套 HTTP 插桩显式关闭：HttpInstrumentation `disableIncomingRequestInstrumentation:true`（`sdkBundle.ts:206`【本次合成复核确认】，仅保留 outbound client span）；结构测试断言 bundleSource 含该 flag 且 runtime 无 registerOnInitialization。【CODE_VERIFIED + MEASURED（structural test 17 passed）】
- 无第二处自包 request hook 创建 span：全仓生产 addHook 清点全部为 onClose 清理或 header/CSRF/安全头逻辑；route/loop 生产文件被结构测试禁止直接 startActiveSpan。【MEASURED｜分块审计 grep addHook】
- 全仓生产代码 span 创建点仅 4 处（本次合成复核 grep 确认）：`businessOperationSpan.ts:166`、`backgroundLoopSpan.ts:181`、`packages/otel-drizzle-postgresjs/src/index.ts:243`、`transactionSeam.ts:106`。【MEASURED】
- 运行证据：error 路径恰好 1 个 root server span（`telemetrySignals.test.ts:159-167` 断言 parentSpanId===null 的 roots 恰 1 且 status=error）；pino 关联测试同时证明每请求单 trace（:180-206）。【MEASURED｜5 passed】
- 入站不受信 trace 头不采信：ServerRootPropagator.extract 原样返回 caller context（ADR-028 D2）。【CODE_VERIFIED｜`serverRootPropagator.ts:29-50`；`sdkBundle.ts:187-195,400`】

### §6.2 业务 span（withBusinessOperationSpan）清单与父子关系

- 冻结词汇 9 个业务 span 名（`businessOperationVocabulary.ts:28-58` 闭联合集），全部有真实调用点且经单一 helper：attempt.start/save/submit/restore/deadline_reconcile（`attempts.candidate.ts:716,1055,1279,1409,904`）、force_submit/time_grant（`attempts.admin.ts:209,303`）、grade（`gradingQueue.ts:380`）、deadline_auto_submit（`deadlineScanner.ts:227`）。调用方文件清单由 structural test 钉死（:41-46）。【CODE_VERIFIED｜本次合成复核 grep 调用点=9】
- 单一 helper（`businessOperationSpan.ts:159-193`）：startActiveSpan + provisional success → body 经 ContainedSpan 细化 → thrown 经 classifyThrown 复分类（4xx AppError=rejected+error_code，其余=exception+ERROR）；span 机制失败降级 NON_RECORDING 且业务结果不变（:186-192）；不调用 recordException（隐私边界 :45-49）；scope=exam.api。【CODE_VERIFIED】
- 父子（请求内）：经 AsyncLocalStorage ambient 落在 @fastify/otel 同 trace 的 request/handler span 之下。【CODE_VERIFIED｜`businessOperationSpan.ts:29-34`；`sdkBundle.ts:264-266`】
- 父子（后台）：deadline_auto_submit 在 scan tick 内自动 re-parent 到 exam.loop.deadline_scanner cycle span（`deadlineScanner.ts:404` withLoopCycleSpan 包整个 cycle、:442 循环内调 autoSubmitAndGrade）；运行实测恰 1 个 rooted cycle span、无 HTTP request span、autoSubmitSpans[0].parentSpanId===cycleSpan.spanId。【CODE_VERIFIED + MEASURED｜`backgroundLoopSpans.test.ts:481-518`（13 passed）】
- 业务 span 只在 HTTP-adapter/后台边界观察 engine command；Domain 与 Exam Engine 零 OTel 依赖（ADR-028 D2）；属性只收 closed-vocabulary 关联 id；outcome ∈ success/rejected/no_op/exception。【CODE_VERIFIED｜`businessOperationSpan.ts:20-27`；`businessOperationVocabulary.ts:61-85`】

**风险（失效注释候选）**：`businessOperationSpan.ts:29-34` 头注释仍写 "a future W4 loop root would parent these automatically"——W4 已落地，"future" 措辞过时（行为正确，仅注释陈旧；AGENTS.md §9 意义上的失效注释）。

### §6.3 后台循环 span/metric 与 root 身份

- 四个 loop（heartbeat/deadline_scanner/client_event_retention/email_outbox）均经单一 helper `withLoopCycleSpan`（`backgroundLoopSpan.ts:171-217`），cycle span 名经 SPAN_NAME_BY_LOOP 冻结双射解析——调用点不能发明名字。【CODE_VERIFIED｜`backgroundLoopVocabulary.ts:42-77`；4 个调用点行号见 §3.1】
- root 身份：后台无 ambient server context → 每 cycle span 自根 trace（parentSpanId=null），禁止伪造 HTTP requestId（`docs/contracts/observability.md:144-146`）；业务 span 在 cycle 内经 ambient 自动成为子 span。运行实测多处断言 cycle parentSpanId===null。【CODE_VERIFIED + MEASURED｜`backgroundLoopSpan.ts:22-30`；`backgroundLoopSpans.test.ts:317-318,503-518`】
- cycle outcome 为 loop 专用闭集 success/empty/failed/exception，与 W3 业务 outcome 有意分层；异常路径仍先记录已计数 work 再 finish exception。【CODE_VERIFIED｜`backgroundLoopVocabulary.ts:13-26,79-92`；`backgroundLoopSpan.ts:177-206`】
- 每 loop 冻结 work-kind allowlist（共 16 系列）；循环插件已有 *Metrics 内存对象、/system/diagnostics、operability.* stdout 告警与 stall 判定 owner 不变——本层只记录事实，hung cycle 表现为 never-ended span，STALL verdict 不在此层。【CODE_VERIFIED｜`backgroundLoopVocabulary.ts:94-179`；`backgroundLoopSpan.ts:29-30`；`docs/operations/technical-telemetry.md:378`】

### §6.4 metric 名称、单位、label 与导出路径

- Loop metrics（W4 冻结）：`exam.loop.cycle.duration`=HISTOGRAM s（label exam.loop.name，4 系列；buckets 0.005..600s）；`exam.loop.cycle.count`=COUNTER {cycle}（name×outcome，≤16 系列）；`exam.loop.work.count`=COUNTER {item}（name×work allowlist）。记录点唯一：settle 边界 recordCycleMetrics。【CODE_VERIFIED + MEASURED｜`backgroundLoopVocabulary.ts:190-216`；`backgroundLoopSpan.ts:79-102,127-152`（backgroundLoopSpans.test.ts 以 InMemoryMetricExporter 验证 series，13 passed）】
- DB metric（W2 冻结）：`db.client.operation.duration`=HISTOGRAM s，bucket 0.001..10；attrs db.system=postgresql、exam.db.connection.role(root|transaction)、exam.db.outcome(success|error)+条件 db.response.status_code。【CODE_VERIFIED + MEASURED（otelDbTelemetry.test.ts 10 passed）】
- **HTTP request metric：as-built 不存在。** 全仓 createHistogram/createCounter 仅 4 处（`backgroundLoopSpan.ts:84,89,93` + `index.ts:165`）【本次合成复核 grep 确认恰好 4 处】；@fastify/otel@1.0.1 index.js 零 meter/histogram/counter 引用【MEASURED｜分块审计 grep 零匹配】；technical-telemetry.md §8 信号所有权表亦只列 HTTP SERVER span 进 Tempo。【CODE_VERIFIED｜`docs/operations/technical-telemetry.md:372-374,364`】
- metric 导出路径（唯一远端）：仅 otlp 态 → PeriodicExportingMetricReader 60s/30s → `${endpoint}/v1/metrics` → collector otlp receiver :4318（`deploy/observability/otelcol.yaml:33-39`，仅 exam-net 内部）→ prometheus exporter :8889（metric_expiration 5m，:68-70）→ prometheus 15s 抓取 job otelcol-exam-metrics（`prometheus.yml:12-16`）。其他模式仪表为 NOOP（W4 containment，`backgroundLoopSpan.ts:69-78`）。【CODE_VERIFIED】
- Prometheus 端实际系列名：counter 加 `_total`、秒单位转 seconds（runbook 验证步骤明示 exam_loop_cycle_count_total）。【CODE_VERIFIED｜`technical-telemetry.md:96-99,364`】

**风险/遗留疑问（结构性缺口裁决缺失）**：ADR-028 D3 写 "HTTP/DB 指标优先采用确认过的 SemConv 词汇"，DB 侧已落地，HTTP 侧只有 span、无任何指标；若 W7.2 的 p99/CPU 对照需要 HTTP 时延指标则无现成系列——是结构性缺口还是有意排除，仓库内无权威裁决记录（→ §10 实验输入 E9）。

---

## §7 A7 日志关联与远端路径

### §7.1 Pino requestId/traceId/spanId 关联

- requestId（ADR-025 权威）：server-generated UUIDv4 由 genReqId 铸造、`requestIdHeader:false` 使 client 头永不能覆盖（`server.ts:133-139`）；onRequest hook 每响应路径回写 server-owned x-request-id（`server.ts:156-160`→`plugins/requestIdHeader.ts:34-38`）。【CODE_VERIFIED】
- trace_id/span_id 注入：PinoInstrumentation `disableLogSending:true` correlation-only 模式（`sdkBundle.ts:218-220`【本次合成复核确认 :219】），只向 stdout 注入 trace_id/span_id/trace_flags，无 OTLP log 导出；日志脱敏与关联字段共存；req 序列化器输出 route template 而非原始 URL（#925）。【CODE_VERIFIED｜`sdkBundle.ts:210-220`；`logRedaction.ts:209-230`；`server.ts:140-148`】
- **关联运行实测（三方闭环）**：真实 init 会话（exporter=memory）+ 真实 Fastify app 断言：响应头 x-request-id 为 UUIDv4、stdout "request completed" 行 reqId===该 header、行内 trace_id 非零 32hex、(trace_id,span_id) 与 retained span buffer 中真实 span 匹配。【MEASURED｜`telemetrySignals.test.ts:180-206`（本次分块审计执行，5 passed）】
- requestId 与 trace 身份权威分离（ADR-028 D2/表一）；入站 traceparent 不采信；后台不伪造 HTTP requestId。【CODE_VERIFIED｜`docs/adr/ADR-028-...md:40-45,73-79`；`serverRootPropagator.ts:29-38`；`docs/contracts/observability.md:144-146`】
- 结构测试钉住关联不静默消失的前提：init 先于 Fastify 构造 + disableLogSending:true + OTEL_LOGS_EXPORTER=none + 无 logRecordProcessors。【MEASURED｜structural test :49-54,234-242（17 passed）】

### §7.2 日志远端路径（filelog→Loki 合同状态）

- 应用侧零远端日志导出：OTEL_LOGS_EXPORTER=none 显式钉死 + disableLogSending:true + 无 logRecordProcessors——Pino→stdout 是唯一应用写出口。【CODE_VERIFIED｜`runtime.ts:346-348`；`sdkBundle.ts:210-220`；structural test :234-242】
- 唯一远端摄入路径（ADR-028 D3 单路径规则）：pino JSON stdout → Docker json-file（50m×5、tag 无条件打点）→ otelcol-logs filelog receiver 只读 tail /var/lib/docker/containers/*/*-json.log（start_at:end、1s poll）→ json_parser → filter/deployment 按 attrs.tag 匹配 OBS_LOGS_TAG_PATTERN（非匹配项 fail-closed 丢弃）→ resource 补 service.name → otlp_http/logs → http://loki:3100/otlp。【CODE_VERIFIED｜`deploy/observability/docker-compose.observability.yml:44-61`；`deploy/observability/otelcol.logs.yaml:61-103,128-151`】
- **filelog→Loki 合同状态：PENDING VERIFICATION，MUST 保持禁用**，直到 technical-telemetry.md §2.1 四条验收（exactly-once 含重启与轮转、无外来容器、同宿主隔离、Docker 直读 caveat 记录）在真实 Linux Docker host 全部通过——W6 WSL2 lab 无法读宿主 json-file 存储；该 leg 拆进独立 overlay（profile observability-logs），已验证 overlay 不挂载宿主 Docker 状态、Loki 在无 logs leg 时 idle。【CODE_VERIFIED｜`technical-telemetry.md:36-53,110-192`；`otelcol.logs.yaml:3-16`；overlay :23-32】
- bound：json-file 50m×5；logs exporter sending_queue 2000×4 + retry 1s→10s、max_elapsed 60s——Loki 不可达降级为有界内存排队后丢弃，永不阻塞应用。【CODE_VERIFIED｜`otelcol.logs.yaml:128-139`】

**风险（已知已记录）**：logs leg 宿主读路径从未端到端验证——"日志进 Loki" 的整条合同当前不可运行（按 runbook 操作会得到空 Loki）；文档已显式 gate，非未记录缺陷。但运维只读 §1 表第一行可能误以为 Loki 随 profile 启动即有数据（§2 verify 步骤 :98-99 有提示）。

---

## §8 A8 基建、历史数据、文档、CI、缺口

### §8.1 benchmark/retention 基建

- 实际环境变量名带前缀：`EXAM_DB_TELEMETRY_BENCHMARK` / `EXAM_DB_TELEMETRY_BENCH_OUT` / `EXAM_DB_TELEMETRY_RETENTION_PROBE` / `TELEMETRY_MEMORY_DUMP_FILE`（另有第五个 `EXAM_DB_TELEMETRY_RETENTION_OUT`）；无裸名变体。【MEASURED｜分块审计 grep 全仓 10 文件命中】
- benchmark 入口 `pnpm --filter @exam/otel-drizzle-postgresjs bench`（= EXAM_DB_TELEMETRY_BENCHMARK=1 vitest run benchmark.test.ts；未设则 describe.skip）。workload：两相 A/B（baseline 无插件 → enabled 同 workload 重跑）；20 warmup + 400 selects + 40 tx×6 语句（statementCount=640）；指标 wallMs/p50/p95/mean/max + 计数交叉校验（相位差断言，不含 warmup 20）：submissions/settles delta=640、root delta=SELECT_OPS+TX_OPS=**440**（=400 selects + 40 个 BEGIN）、transaction delta=TX_OPS×5=200、scopedClosures delta=TX_OPS=40、errors=0。输出 JSONL 追加到 EXAM_DB_TELEMETRY_BENCH_OUT，缺省 out/otel-w964/W2.2/artifacts/benchmark.jsonl。【CODE_VERIFIED｜本次合成复核（修订先前的 root=460 笔误——460 系把 WARMUP_OPS=20 混入，delta 断言不含 warmup）：`benchmark.test.ts:52-58`（WARMUP_OPS=20/SELECT_OPS=400/TX_OPS=40/STATEMENTS_PER_TX=6）与 :210-226 断言块（`:210-212` statementCount、`:217-221` root===SELECT_OPS+TX_OPS、`:222-225` transaction===TX_OPS×(STATEMENTS_PER_TX-1)、`:226` scopedClosures===TX_OPS）；`benchmark.test.ts:48-49,79-88,159-245`；`package.json:28`】
- retention 探针：常规 test:retention（计数/分类 + 需 --expose-gc 的 WeakRef 可回收性，无 gc 时 skip）+ EXAM_DB_TELEMETRY_RETENTION_PROBE=1 门控长循环实验 probe:retention（300 tx、64KB Buffer 捕获、full-GC quiesce 后记录 heapUsed/external/rss/cohortRefs 等，JSONL 写 EXAM_DB_TELEMETRY_RETENTION_OUT）。【CODE_VERIFIED｜`scopedClosureRetention.test.ts:53-63,127-148,151,156-270`；`package.json:29-30`】
- TELEMETRY_MEMORY_DUMP_FILE：API 侧 memory-exporter 见证缝（settings 空串缺省、graceful shutdown 时 JSONL best-effort 追加、exit-neutral）；链路 `settings.ts:854`→`runtimeConfig.ts:828`→`runtime.ts:299-302,449-460`；测试覆盖 stubEnv 写出/禁用/缺省三路径。【CODE_VERIFIED｜`telemetrySignals.test.ts:44`；`telemetryExceptionScrub.test.ts:125`；`settings.test.ts:131`】
- 官方跑法文档：README §Benchmark/§Retention probe 三命令及 before/after 对比方法。【CODE_VERIFIED｜`packages/otel-drizzle-postgresjs/README.md:136-169`】
- 审计树 out/ 为空；仅 exam-fix-otel-scoped-handler-retention 工树存 out/otel-w964/retention-fix/ 四个 JSONL（属 PR #994 实验）。【MEASURED｜本次合成复核 `ls out/ | wc -l` → 0；分块审计 ls 该工树确认四文件】

**风险**：benchmark p50/p95 与 retention heap/external 数字对运行环境（WSL2 单机、docker PG）敏感，历史 JSONL 不可当 CI 基线；W7 性能验收协议（lifecycle-S50 replay 3×3/6 replicates）没有落成仓库脚本。

### §8.2 PR #980（W7.2）历史性能数据：位置、结论与方法论局限

- ask 点名的 `gh pr view 980 --comments` 实际执行失败（GraphQL Projects-classic 弃用报错）；改用 `gh pr view 980 --json comments` 成功——唯一评论是 CodeRobot 样板，无性能数据；`gh api .../pulls/980/comments` 返回空。【MEASURED】
- 性能数据全部在 PR #980 body（feat(telemetry): integration cleanup ledger and acceptance fixes，MERGED 2026-11-14T15:25:49Z），节名 "🔴 Performance budget — re-tested on the fixed stack (2026-11-13)"。【MEASURED】
- **结论数据（PR 记录，非本会话实测）**：预算 CPU 与 p99 各 ≤5%。pre-fix（3×3 lifecycle-S50 replay）：On/no-export CPU +7.5~+12.4%、p99 +1.4~+9.9%；On/full-OTLP CPU +8.8~+16.4%、p99 +7.4~+23.7%。fixed stack 重测（0e82e087，6 replicates，quiet-machine r4–r6 primary）：On/no-export CPU +4.3~+11.4%（median +10.4%）、steady p99 −2.3~+5.9%（median +2.7%）；On/full-OTLP CPU +5.3~+19.0%（median +9.1%）、p99 +1.0~+5.3%（median +2.1%）；RSS +5~16%（预算外容量数据）。**判定 FAIL → 生产启用 NO_GO，默认保持 Off，优化优先、不给 waiver。**【CODE_VERIFIED（PR body 引用）】
- 方法论局限（PR body 自述）：r1–r3 携带 transient host-load 相位仅 r4–r6 主数据；分支层归因在 W6 以下不可能（TELEMETRY_EXPORTER W6 才进 settings 契约）；**TELEMETRY_SAMPLE_RATIO=0 无改善 → 成本是 plumbing 而非 span 量**；per-signal 成本归因（instrumentation vs metric aggregation vs export）在 granular runtime 上尚未重推，是下一步优化目标。【CODE_VERIFIED（PR body）】
- 基建设计局限：benchmark 入口只记证据不断言预算（`README.md:149-151`、`benchmark.test.ts:18-20`）；预算数字来自 untracked out/otel-w964/W7.2/perf/ 的协议，小样本单机 WSL2，无仓库内可复现脚本。【CODE_VERIFIED】
- untracked 证据目录 out/otel-w964/W7.1、W7.2 在审计树不存在；docs/ 与 Issue 中无 W7 性能数据落盘副本（#964 无评论、grep 无命中）。【MEASURED】
- 相邻证据：retention-fix 四 JSONL 属 PR #994（MERGED 2026-11-14T16:43:27Z），body 结论 BASE external 13.73→23.56MB（~65KB/tx 线性）cohort 30/30 存活 vs FIX external 恒 2.59MB、cohort 0 存活；bench wallMs 重叠噪声、CPU INCONCLUSIVE；JSONL 实测与 body 表格一致。【MEASURED｜gh pr view 994 body + cat 四 JSONL】

### §8.3 docs/research/ 既有审计报告要点

- `docs/research/db-test-post-649-perf-attribution.md`（2026-09-28，RESEARCH/MEASUREMENT-ONLY）：post-#649 测试套件墙钟归因；明确 WSL2+Docker Desktop 测量能力边界（perf 无法归属 PG 容器、cgroup 经 docker exec、bpftrace 按 comm 可见）；warm steady-state 方法；raw artifacts 在 /tmp 不持久。【CODE_VERIFIED｜:1-10,17-45,87-89】
- `docs/research/exam-secure-observability-remediation/`（pre-OTel 观测加固战役 #800 PR-B / #922–#926 证据库）：04-PERFORMANCE.md A/B/C/D 变体实验——B/D 响应字节 +52B 确定、吞吐/p95/p99 变化在噪声带、>±3% 差值不声称可分辨、C 只是门变体安全完备性不成立（canary LEAK_COUNT:2）；另有 review-architecture-performance.md（独立只读评审）与 10-INTEGRATION-CI-AND-PERFORMANCE.md。【CODE_VERIFIED｜04-PERFORMANCE.md:1-12,26-45,47-63；review:1-16】
- **docs/research/ 不存在 OTel/W964/ADR-028 主题的审计报告**——OTel 侧实验记录全部在 PR body + untracked out/，未沉淀进 docs/research。【MEASURED｜grep 无命中】

**风险**：telemetry 主题实验证据沉淀断层——pre-OTel 战役有完整 docs/research 沉淀惯例，W964 OTel 战役未遵循，跨战役可比性与长期可审计性弱。

### §8.4 CI 工作流中 telemetry/benchmark 相关 job

- .github/workflows 仅 ci.yml / open-code-review.yml / release.yml；grep telemetry/benchmark/otel 全部 workflow **0 命中**——不存在专门 job。【MEASURED】
- telemetry 代码进 CI 的唯一路径：package-coverage 的 `pnpm --filter "./packages/*" coverage`（ci.yml:332）经 turbo 触达 otel-drizzle-postgresjs#coverage（turbo.json:45-60）；因 EXAM_DB_TELEMETRY_BENCHMARK / RETENTION_PROBE 未设，benchmark 与 retention-probe 在 CI 恒 skip；GC 断言需 --expose-gc（未设）也 skip——PR #994 自述 "CI runs the deterministic counting/classification tests, not the GC assertion"。【CODE_VERIFIED】
- W7 性能验收协议不在任何 CI job 中运行，纯本地手动。【CODE_VERIFIED】

**风险**：性能预算（≤5%）与 retention 可回收性在 CI 无守护——回归只能人工跑 bench/probe 发现。
**遗留疑问**：是否应有 nightly/手动 bench+probe 回归工作流——设计决策，仓库/Issue 无讨论。

### §8.5 遗留覆盖缺口清单

- **性能预算缺口（最大结构性缺口）**：#964 §6 明文预算是验收预算非实测事实（body:156）；PR #980 实测 FAIL → NO_GO；per-signal 归因优化任务无 owner Issue、无 CI 守护、原始数据 untracked。【MEASURED（gh）】
- W5 缺口：cancel/timeout 遥测 capture 策略 pending Owner decision，nothing implemented。【CODE_VERIFIED（PR #980 acceptance 表）】
- 集成验收缺口：fixed-stack e2e/故障注入重跑在 merge 决策前 pending（R5/R6 注记）；R6 只重跑了 CI=true pnpm verify EXIT 0。【CODE_VERIFIED（PR body）】
- logs leg 缺口：PENDING VERIFICATION（§7.2）。【CODE_VERIFIED】
- 环境受限 SKIPPED 项（PR #980 明示非失败）：DB-death + SIGTERM 为已知 #351 形态——进程在 shutdownTelemetry 前 exit 0、telemetry flush 丢失（业务语义不变）；Restore 故障注入只停在测试层；RSS +10%/+15% 为预算外容量数据。【CODE_VERIFIED（PR body）】
- 插件声明覆盖边界缺口：cursor() chunk 级语义无生产调用方、无 fixture（README §Declared coverage boundary）。【CODE_VERIFIED｜README:113-122】
- 治理缺口：ADR-028 PROPOSED；生产启用独立 Owner 裁决当前 NO_GO；#964 umbrella W1–W7 复选框全部未勾选（W0 为 [x]）而 #973–#980 已 merge——umbrella 状态与实现现实不同步。【CODE_VERIFIED｜ADR:5-6；gh issue view 964 body:129-136】
- 范围性缺口（有意为之，#964 §8 明确不在 V1）：日志检索 UI、requestId-to-logs 查询 API、跨租户原始遥测读取、浏览器全量 Trace、SaaS 上传等；§9 列 V1 后标准化议程不阻塞 V1。【CODE_VERIFIED（body:175-186）】
- 代码 TODO 清查：telemetry 相关目录 0 个 TODO/FIXME/HACK；packages/db 仅有的两个 TODO 与 telemetry 无关（systemStatsRepo.ts:73 及其测试 :180）；PR #994 自述残留：rootClosures 强集持有已关闭 pool 的 root handler 至进程退出（有界、documented out of scope）。【MEASURED（grep）+ CODE_VERIFIED（PR body）】
- DoD 缺口：#964 §7 终态 Gate 全部未勾选，含 "性能 A/B 有可复现脚本、原始结果、前后 SHA"（body:170）——与 untracked 证据现状直接冲突。【CODE_VERIFIED】
- **遗留疑问（UNKNOWN）**：#980 R6 之后、merge 之前 fixed-stack 的 e2e/fault-injection 重跑是否实际执行过——PR body 各轮注记均写 pending，合并时最终状态无正面记录。

---

## §9 特别核查项逐条结论

任务命令要求的 9 项核查，逐条给唯一答案（第 10 项为复核轮增补的安装路径核查；详细证据见对应章节）：

| # | 核查项 | 结论 | 等级 | 关键证据 |
| --- | --- | --- | --- | --- |
| 1 | **#994 修复在位** | **在位**。HEAD merge 1d689b4a 含 f93e07ce；`index.ts:190` WeakSet\<object\>、`:223` canHoldWeakReference、`:234` 守卫；回归测试随 merge 进 master（未运行，回收性数字引自 commit message） | MEASURED + CODE_VERIFIED（本次合成复核 git show + grep） | §4.4 |
| 2 | **Off facade 清单** | 静态加载面 = 仅 `@opentelemetry/api` facade；生产代码静态值导入仅 `businessOperationSpan.ts:1-7` 与 `backgroundLoopSpan.ts:1` 两文件（structural test 钉死，`serverTelemetryWiring.structural.test.ts:204-218`）；其余 4 处 import type 编译期擦除；sdkBundle 仅动态到达。探针：NonRecordingSpan / NoopMeterProvider / ProxyTracerProvider 无 delegate / 零 globalThis 注册 | CODE_VERIFIED + MEASURED（本次合成复核 grep） | §3.1 |
| 3 | **三态 MeterProvider 差异** | **none：无 MeterProvider**（metricsSdk=null，startMetrics 仅 otlp 分支）——但 span 仍全量记录+scrub 后丢弃，facade meter NOOP；**memory：同 none 的 metric 面（无聚合），trace 面加 BSP→BoundedMemorySpanExporter**；**otlp：唯一注册全局 MeterProvider + PeriodicExportingMetricReader(60s/30s)，facade instruments 变真序列**。三态均有完整 TracerProvider+scrub 链+ALSCM+propagator+instrumentations | CODE_VERIFIED（本次合成复核读 runtime.ts:339-400 全分支） | §3.2 |
| 4 | **Fastify span owner 唯一性** | **唯一**：@fastify/otel `instrumentHooks:false`（唯一创建点 sdkBundle.ts:232-234）；HttpInstrumentation `disableIncomingRequestInstrumentation:true`；全仓生产 span 创建点恰 4 处；addHook 清点无第二处；运行测试断言 error 路径恰 1 个 root server span | CODE_VERIFIED + MEASURED（本次合成复核 grep 4 处） | §6.1 |
| 5 | **DB 重复计量疑点** | **不重复**：statement 层（每提交语句首个 thenable 消费点，`!executed`+WeakSet 首见去重）与逻辑层（仅 executeInTransaction 边界的 logical/attempt span + retry event）是不同测量点、包含式嵌套非重复记录；histogram 只在 statement 层；事务层零 metric；基准相位断言 submissions==settles==语句数 | CODE_VERIFIED | §5.2 |
| 6 | **无意义 attribute** | **存在一处确证**：`UrlScrubSpanProcessor.onEnd` 无条件给 100% 非 HTTP span 写 `url.path="(unrouted)"`（`urlScrubSpanProcessor.ts:35` 占位常量、:62-74 无类型判别的写点）——语义约定键的跨类型污染 + ~22B/span 常量放大 + 伪路由桶聚合风险 | CODE_VERIFIED（本次合成复核读 onEnd 全文） | §4.3 |
| 7 | **高频重复操作** | **无重复 processor/context 操作**：单 MultiSpanProcessor、scrub 常数工作、DB 每语句恰一次观察、事务 context 操作各一次、facade memoization 正确。但存在两类**可消除的恒定分配**（非重复计量）：NOOP histogram 下每 settle 标签对象分配（缺省 On 部署即 exporter=none）；错误语句 5 次 cause 链 walk + 5 Set + 2 数组展开 | CODE_VERIFIED；量级 INFERRED 未测 | §4.3, §5.5 |
| 8 | **三类信号出口** | **Traces**：唯一远端 = OTLP/HTTP → collector :4318 → Tempo（14d）；备选 witness = memory ring(1000)+可选 dump 文件。**Metrics**：仅 otlp 态有远端 = /v1/metrics → collector → Prometheus :8889 → 15s 抓取（14d）；其余态 NOOP。**Logs**：应用侧零导出（disableLogSending+LOGS_EXPORTER=none）；唯一远端路径 filelog→Loki leg **PENDING VERIFICATION 必须保持禁用**——即三类信号中 logs 的远端合同当前不可运行。**HTTP request metric 不存在**（全仓恰 4 个 metric 创建点） | CODE_VERIFIED（本次合成复核 grep 4 处创建点） | §6.4, §7.2, §3.2 |
| 9 | **exporter 故障行为** | BSP 队列满即丢无背压（`_addToBuffer` :63-76）；导出失败批次已 splice 不回队、无重试（:100-110）；OTLP 重试上界 MAX_ATTEMPTS=5 + 双层 timeout（BSP 30s / exporter 10s）；memory exporter 零故障面；metric reader 失败只丢当轮；关机 3s 共享 deadline + allSettled 永不抛。**关键缺口：全程应用层不可见**——无 diag logger（grep 0 命中）+ dropSpans 计数接 NOOP self-obs meter → collector 假死运行态完全静默 | CODE_VERIFIED（本次合成复核 BSP/retrying-transport/diag grep） | §4.5 |
| 10 | **DB 安装路径 marker 是否零网络**（增补于复核轮） | **静态推演成立、无可执行钉子**：安装路径 `installStatementSeam` 以 `postgres("postgres://127.0.0.1:1/none")` marker client 取 Query 原型、`markerClient.end({timeout:0})` 即弃（`driverStatementSeam.ts:146-149`）；root-pool 注册以真实池 `sql.unsafe("select 1")` 创建懒 marker、只读 handler 不消费（`index.ts:300-303`，注释引 W2.1 §2.2/S3）。"不拨号"的支撑 = postgres.js Sql 构造不连接 + Query 惰性（query.js handle() 消费时才翻转 executed，本会话静态复核）+ 代码注释；**但 W2.1 probe 文档两树均不存在、仓库无测试断言 marker 不发起连接**（offNoSideEffects.test.ts 只在测试进程内创建同形 marker，不构成对"不拨号"的断言）→ 探针级确认 UNKNOWN | INFERRED（静态推演）+ UNKNOWN（运行级确认）；本次合成复核 `driverStatementSeam.ts:143-153`、`index.ts:300-307` | §5.1, §5.3, §11#12 |

---

## §10 对实验设计的输入（Stage D-G 需实验裁决的疑点）

以下疑点静态审计无法裁决，按裁决价值排序。标注【实验类型】与设计要点。

### E1. per-signal 成本归因（最高优先——NO_GO 根因）
【性能 A/B】PR #980 已证 SAMPLE_RATIO=0 无改善（开销在 plumbing），但 instrumentation vs metric-aggregation vs export 的分量未在 granular runtime 上重推。三臂对照（Off / On-no-export / On-otlp）需在可控负载下逐信号 ablation（如分别只装 HttpInstrumentation、只装 fastify-otel、只装 DB 插件、只装 metric reader），固定生命周期与 quiet-machine 复测纪律（r1-r3 相位污染教训）。静态线索：每请求 fastify-otel 2 span（W1.1 历史数字，E1 待复测，见 §4.1 附注）+ 业务 1-2 span + DB 每语句 1 span + ALSCM 进出 + scrub 常数工作（§4.1-§4.3、§5.1）。注意：**无可复现脚本**（协议只在 untracked out/），实验前必须先落成脚本（#964 DoD :170 要求）。

### E2. 两个候选优化的收益量化
【微基准/集成 A/B】① NOOP histogram 标签对象分配消除（exporter=none/memory 是缺省 On 部署形态，每 settle 一次分配，§5.4/§5.5）；② 错误路径 cause 链 walk 共享（5 walk→1-2 walk，§5.5）。现有 bench 入口（640 语句固定负载）可直接扩展错误语句相位；W7.2 协议下验证对 CPU/p99 中位数的影响是否 ≥ 噪声带（pre-OTel 战役的 >±3% 不可分辨纪律可复用，§8.3）。

### E3. On+none 的真实开销形态
【性能测量】静态已证 none 是"全量记录无导出"（§3.2），但记录成本（SpanImpl+属性存储+BSP 缺席）与 otlp 态的差值未测。若 E1 显示 instrumentation 占大头而 export 占小头，则 none 作为运维降级档的实际节流率需要数字支撑。

### E4. exporter/collector 故障注入的应用可见性
【故障注入】静态证明失败面完全静默（无 diag logger、dropSpans 接 NOOP meter，§4.5）。需要实测裁决：① collector 假死（accept-but-never-answer）下 trace 30s 静默丢弃 + metric 60s 跳轮的真实行为；② 队列满（2048）后 span 丢弃速率；③ 是否值得把 globalErrorHandler 桥到 pino warn（设计修复的动机证据）。既有 4 场景注入（unreachable/500-reject/35s slow-read/blackhole，PR #980）未覆盖"假死"与"队列满"两个静态推演的最坏形态。

### E5. Off 态零网络面
【运行时测量】ADR-028 表三要求 "Off 态遥测网络请求必须为零（实测证明）"。分块审计的 Off 探针是模块级（无进程级网络面测量）；W1.1 历史 probe（zero spans/zero connections/unmodified exit）不可重复执行。需要真实进程 + 连接审计（ss/strace/netstat 或容器网络计数）钉死零网络。

### E6. #994 回收性测试复跑
【真实 PG + --expose-gc】`scopedClosureRetention.test.ts` 与 `probe:retention` 本审计未运行（§4.4）。修复在位已实证，但 post-fix 8/8 可回收、300tx 探针 0/30 存活的数字是 commit message 记录。低成本复跑可把该结论升级为本机 MEASURED；同时验证 benchmark 相位断言（submissions=settles=640）。

### E7. instrumentation 0.300.0/0.301.2 共存
【冒烟/co-run probe】@fastify/otel 内部依赖 instrumentation 0.300.0 与 SDK 代 0.301.2 共存于单 API 实例（§1 风险）。注释称 W1.1 probe 实测无冲突，但无仓库内可重复证据。升级 OTel 版本或 CI 化前需一次可重复的 co-run 冒烟（可用 structural+wiring 测试全量 + telemetrySignals 三方闭环作为判据）。

### E8. `url.path="(unrouted)"` 的下游影响
【导出采样检查】静态证明污染面是 100% 非 HTTP span（§4.3）。用 memory exporter + dump 文件（TELEMETRY_MEMORY_DUMP_FILE，已有测试覆盖的缝）实测真实负载下带 `(unrouted)` 的 span 占比与 attribute 体放大，裁决是否值得给 scrubber 加 HTTP-span-only 判别（如仅当 span 曾有 RAW_URL_KEYS 或 http.route 存在时写 url.path）。

### E9. HTTP request metric 缺口的裁决输入
【测量+治理】W7.2 的 p99 对照若无 HTTP 时延指标，只能依赖 span 时长（Tempo 查询）。实验上可先验证从现有 request/handler span 派生 p99 是否满足验收口径；治理上该缺口是"结构性缺失还是有意排除"需 Owner 裁决（§6.4 风险）——实验结果作为裁决输入。

### E10. shutdown 3s deadline 到期路径
【慢 receiver 注入】既有 telemetryShutdownSlowReceiver.test.ts 钉住 3s 共享 deadline（双 face 不串行），但 deadline 到期后未完成的 sdk.shutdown 被放行、依赖 2s exit assist 兜底的路径（§3.3 风险）需要 >3s 挂死 exporter 的实测（进程是否 8s 内退出、是否有遗留句柄）。DB-death+SIGTERM 的 #351 形态（flush 丢失）已在 PR #980 记录为 SKIPPED，若要闭合需同实验覆盖。

### E11. SQLSTATE 标签基数实测
【导出检查】`db.response.status_code` 有界但开放（§5.3 风险）。真实负载下不同 SQLSTATE 数量、otlp 态 Prometheus 系列数实测，验证 "低基数" 自称是否成立（预期成立，但未测）。

### E12. 安装路径 marker 零网络确认（复核轮增补，对应 §9 第 10 项）
【运行时测量】On 路径 `installStatementSeam` 的 `postgres("postgres://127.0.0.1:1/none")` marker client 与 root-pool 注册的 `sql.unsafe("select 1")` 懒 marker（`driverStatementSeam.ts:146-149`；`index.ts:300-303`）"创建即弃、不拨号" 目前只有注释 + Query 惰性静态推演支撑。用连接审计（ss/strace/PG 端 pg_stat_activity 或连接计数）在真实启动上确认两处 marker 均无连接尝试；可与 E5 同一 harness 覆盖。若证伪（marker 拨号），需评估 127.0.0.1:1 快速失败的启动延迟与日志噪声面。

### 不需要实验、直接可收敛的项（非 Stage D-G 范围，记录备查）
- 失效注释修正：`businessOperationSpan.ts:29-34` "future W4" 措辞（§6.2 风险）——施工授权下的小改。
- ADR-028 PROPOSED→评审收敛、#964 umbrella checkbox 同步（§8.5）——治理动作非实验。
- logs leg §2.1 四条验收——需要真实 Linux Docker host 的运维实验（已在合同中 gate，非新增疑点）。

---

## §11 UNKNOWN / 未验证清单（汇总）

1. **#980 merge 前 fixed-stack e2e/fault-injection 重跑是否实际执行**——PR body 各轮写 pending，无正面记录。UNKNOWN。
2. **W7 性能原始 JSONL（out/otel-w964/W7.1、W7.2）本机是否仍存在于其他 worktree/备份**——审计树 out/ 空，retention-fix 四文件在 exam-fix-otel-scoped-handler-retention 工树（属 #994），W7 证据未找到。UNKNOWN。
3. **W2.1 真实 PG 探针文档 out/otel-w964/W2.1/db-seam-probe.md**——两工作树均不存在（代码注释引用它）。UNKNOWN。
4. **W1.1 probe（co-run、F2、F6、Off-state 网络面）**——仅注释/PR 引用，原始产物未定位。UNKNOWN。
5. **五个真实 PG 测试套件（offNoSideEffects/lifecycle/retention/benchmark/retry）与 GC 断言**——本审计未运行（CODE_VERIFIED 来自读测试代码）。
6. **分配热点纳秒/字节量级**——未测（benchmark 未运行）。
7. **ADR-028 Owner 评审时间与结论**——治理悬置，无法预测。
8. **HTTP request metric 是否在后续阶段计划内**——仓库内无裁决记录。UNKNOWN（→ E9）。
9. **nightly bench/probe 回归工作流是否应存在**——无讨论记录，设计决策悬置。
10. **Tempo/Loki/Prometheus 14d 留存是否需与业务侧 audit/client_events 保留策略对齐**——当前是独立 operator knob，无 cross-signal 一致性合同。悬置。
11. **本合成会话**：未运行任何测试套件；只做了只读抽查（git/grep/sed/find/node_modules 源码读取），抽查项均已在文中标注"本次合成复核"。
12. **DB 安装路径 marker 的零网络断言（installStatementSeam marker client 与 root-pool 注册 marker）**——静态推演成立（Query 惰性 + 注释），但 W2.1 probe 文档缺失、无测试断言不拨号，运行级确认缺失（→ §9 第 10 项、E12）。UNKNOWN（运行级）。
