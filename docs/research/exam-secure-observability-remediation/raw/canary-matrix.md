# Canary 结果矩阵 — normalizeRouteForStorage pathname 投影（#864 疑点）

- 日期：2026-11-08；git HEAD `423f2945`；被测源文件 `apps/api/src/routes/clientEvents.ts`（最后一次相关提交 `9e990532` 2026-11-05），文件 sha256 `3794a4090b7759baca448fdf4a9bfd7c69677cda7fa1174e5aa2cb0941dcd5d8`。
- 环境：`.tmp/secure-correlation-audit/env/MANIFEST.json`（API http://localhost:3000 APP_MODE=e2e，DB `exam_ci_audit`，身份已核验 `exam|exam`）；投放身份 candA1（cookie auth-token），事件带已证实引用 attemptId=`f665c325-…`、examId=`6b8d0782-…`。
- 单元级：`canary/unit-normalize.mjs` 从生产文件逐字提取 `USER_AGENT_MAX_LENGTH` + `normalizeRouteForStorage`（提取片段 sha256 `2b63c772…`，670 字节），以 Node 24 原生 type-stripping 经 `canary/extracted-normalize.ts` 执行——执行的是生产代码文本本身（SOURCE_EXTRACTED），非重写实现。输出 `canary/unit-normalize.out.txt`。
- HTTP 级：`adversarial/post-canaries.mjs`（主批 31 事件一次 200 `{"accepted":31}`；两条预期 400 负例），原始请求/响应 `adversarial/post-canaries.out.txt` / `post-canaries.run.txt`。
- 金丝雀全部为合成 `EXAMAUDIT-CANARY-RT-*`，无真实用户数据。

## 分类图例

原样持久化＝DB 中出现未编码金丝雀字节；编码持久化＝出现百分号编码形态（注明解码次数可还原）；脱敏后持久化＝值被替换/剥离；读取端再暴露＝调查端点响应中出现；服务端拒绝＝4xx 且值未回显。

## 结果矩阵（每例：单元输出 = DB 实测 = timeline 读取端）

| # | 用例 | 投放 route / 载体 | normalizeRouteForStorage 输出（=DB route 列） | 分类 | timeline 再暴露 |
|---|---|---|---|---|---|
| RT-1 | 正常 SPA 路由 | `/exams/EXAMAUDIT-CANARY-RT-1` | `/exams/EXAMAUDIT-CANARY-RT-1` | 原样持久化（设计内） | 是（route 字段原样） |
| RT-2 | UUID path | `/attempts/2f9c1a4e-…/EXAMAUDIT-CANARY-RT-2` | 原样 | 原样持久化 | 是 |
| RT-2B | 非 UUID opaque ID | `/u/EXAMAUDIT-CANARY-RT-2B-xyz789` | 原样 | 原样持久化 | 是 |
| RT-3 | **token 在 path** | `/password-reset/EXAMAUDIT-CANARY-RT-3` | `/password-reset/EXAMAUDIT-CANARY-RT-3` | **原样持久化（真实泄露反例）** | **是** |
| RT-4 | token 在 query | `/exam/list?token=…RT-4` | `/exam/list` | 脱敏后持久化（query 剥离） | 否 |
| RT-5 | token 在 fragment | `/exam/list#token=…RT-5` | `/exam/list` | 脱敏后持久化 | 否 |
| RT-6 | 百分号编码 | `/reset/%45%58%41%4D…RT-6` | 编码形态原样保留 | 编码持久化（1 次解码还原） | 是（编码形态） |
| RT-7 | 双重编码 | `/reset/%2545%2558%2541…RT-7` | 双重编码形态保留 | 编码持久化（2 次解码还原） | 是 |
| RT-8 | **编码 ?/=/ 走私 query** | `/a%2Fb%3Ftoken%3D…RT-8` | `/a%2Fb%3Ftoken%3DEXAMAUDIT-CANARY-RT-8`（金丝雀明文+走私结构） | **编码持久化，单次解码即得完整 query** | 是 |
| RT-9 | Unicode 路径 | `/考试/…RT-9` | `/%E8%80%83%E8%AF%95/EXAMAUDIT-CANARY-RT-9` | 编码持久化（CJK 编码，ASCII 原样；1 次解码还原） | 是 |
| RT-10 | 大小写变化 | `/Exam/EXAMAUDIT-canary-rt-10` | 原样（含大小写不变） | 原样持久化 | 是（小写形态） |
| RT-11 | 绝对 URL | `http://client.example/exam/…RT-11?token=…#f` | `/exam/EXAMAUDIT-CANARY-RT-11`（query/frag 剥离，path 保留） | path 段原样持久化 | 是 |
| RT-12 | userinfo（http 形） | `http://user:…RT-12@example.com/path` | `/path` | 脱敏后持久化（userinfo 不进 pathname） | 否 |
| RT-12B | **opaque-scheme userinfo** | `user:…RT-12B@example.com/path` | `EXAMAUDIT-CANARY-RT-12B@example.com/path` | **原样持久化（URL 解析器 quirk：非特殊 scheme 的 opaque path 含凭据）** | **是** |
| RT-12C | data: URL | `data:text/html,…RT-12C` | `text/html,EXAMAUDIT-CANARY-RT-12C` | 原样持久化（opaque path 整体保留） | 是 |
| RT-13 | malformed URL | `http://[?token=…RT-13` | `http://[` | 脱敏后持久化（fallback 在 `?` 截断） | 否 |
| RT-13B | malformed（坏端口） | `http://example.com:abc/x?token=…` | `http://example.com:abc/x` | 脱敏后持久化 | 否 |
| RT-14 | CRLF/NUL 控制字符 | `/exam/a\r\nb\x00c?token=…RT-14` | `/exam/ab%00c`（CRLF 被 URL 解析移除，NUL→%00，query 剥离） | 脱敏后持久化（控制字符被规范化） | 否 |
| RT-14B | **malformed+原始 CRLF** | `http://[\r\n…RT-14B?x=y` | `http://[\r\nEXAMAUDIT-CANARY-RT-14B`（**原始 CR/LF 字节入库**） | **原样持久化（fallback 分支不清洗控制字符；timeline JSON 中为 `\r\n` 转义，无日志注入）** | 是 |
| RT-15 | 499 字符 route 尾部金丝雀 | 493 字符 | 全长保留 | 原样持久化 | 是 |
| RT-15B | Unicode 膨胀越界 | 326 unit → pathname 900+ 编码字节 | 截断至 500 字节（%E8 序列中段截断，金丝雀丢失，尾部不可解码） | 截断边界生效 | 否 |
| RT-15C | 输入 >500（仅单元） | 1124 字符 | 截断至 500 | 截断生效（线上 schema 先拒） | n/a |
| RT-16A | metadata 无害键+普通敏感值 | `{note:"…RT-16A-plainsecret"}` | `{note:"EXAMAUDIT-CANARY-RT-16A-plainsecret"}` | 原样持久化（#875 明示非目标：非凭据形状不检测）；**timeline 不暴露**（name 不在 allowlist） | 否 |
| RT-16B/C/D/E/F/G | 凭据形状值/黑名单键 | Bearer…/URL userinfo/`password`/`answer`/`message`/JWT | 全部 `[redacted]` | 脱敏后持久化 | 否 |
| RT-17 | 嵌套+字符串数组 | `{arr:["…17A",{k:"…17B",token:"…17C"}],nested:{deep:"…17D"}}` | 17A/17B/17D 原样、17C（键 token）redacted | 数组/嵌套内原样持久化；timeline 不暴露 | 否 |
| RT-18A | 超长 route 触发 400 | 501 字符 | HTTP 400，错误体仅含 field 路径+约束，**值未回显** | 服务端拒绝 | 否 |
| RT-18B | **User-Agent 头携带** | `user-agent: canary-agent/1.0 …RT-18B` | 31/31 行 `user_agent` 列原样（无脱敏路径） | 原样持久化（at-rest；timeline 不返回 userAgent） | 否 |
| RT-18C | name 通道 | name=`EXAMAUDIT-CANARY-RT-18C` | 原样（≤120 机器标识符通道） | 原样持久化 | 是（name 字段） |
| RT-18D | clientSessionId 普通串 | `…RT-18D-session` | 原样 | 原样持久化 | 否 |
| RT-18E | clientSessionId JWT 形 | `eyJ….…18E….aaaa…` | `[redacted]` | 脱敏后持久化 | 否 |

## 读取面汇总

| 读取面 | 金丝雀出现 | 证据 |
|---|---|---|
| POST /client-events HTTP 响应 | 否（仅 `{accepted:n}`） | post-canaries.out.txt |
| 400 校验错误体（值回显） | 否 | post-canaries.out.txt（RT-18A/A2） |
| client_events 表（route/metadata/name/user_agent/client_session_id，raw+pct1+pct2） | 是（见矩阵；形态扫描另有 LIKE 通配符假阳性备注） | db-route-dump.txt、db-metadata-dump.txt、db-form-scan.txt、db-per-event-classification.txt、db-literal-pct-scan.txt |
| server.log（Pino 全文） | 0 处（请求体不入日志） | serverlog-scan.txt |
| audit_logs 表（metadata/user_agent/target_id/actor_id） | 0 处 | db-form-scan.txt 第二段 |
| Proctor timeline（GET /admin/attempts/:id/proctor-events，已指派 proctorA1） | **12 行**：11 行 route 字段原样（RT-1,2,2B,3,8,9,11,12B,12C,14B,15）+1 行 name 字段（RT-18C）；metadata 全部 `{}`（allowlist 默认拒绝） | timeline-proctorA1.json、timeline-field-analysis.txt |
| 未指派 proctor（proctorA2） | 404，0 处 | readside-checks.out.txt |
| Admin 审计 timeline（/admin/attempts/:id/timeline，audit_logs） | 0 处 | readside-checks.out.txt |
| CSV export（/exams/:id/export/scores） | 线上 409（无已评分 attempt，未产出 CSV；该端点源码仅导出成绩列，无 client_events 字段）＝部分验证 | readside-checks.out.txt、export-scores.csv、apps/api/src/routes/export.ts:25-33 |

## 核心结论：是否存在「真实泄露反例」

**存在。** pathname 投影不能阻止敏感值以可还原形式落库并在调查端点再暴露，具体三条通路（全部 LIVE_VERIFIED）：

1. **RT-3 / RT-8**：secret 位于 path 段（或以 `%3F`/`%3D` 编码走私的 query）时，`client_events.route` 原样/单次解码可还原地持久化，并经 `GET /admin/attempts/:attemptId/proctor-events` 原样返回给已指派 Proctor/Admin。#875 注释宣称的「query-free at rest」在字节层面成立（无字面 `?`），但敏感值本身完整保留——一个把 `encodeURIComponent(location.href)` 当 route 发送的 buggy sender（正是该函数注释声称要兜住的场景）会把整条 query（含 token）以编码形态送入库。
2. **RT-12B / RT-12C**：非特殊 scheme 的 opaque path 使 `scheme:SECRET@host` 的凭据与 `data:` 载荷原样成为「pathname」，绕过 userinfo 剥离；`sanitizeClientEvent` 对 metadata 值有 `containsUserinfoUrl` 检测，route 通道没有等价防线。
3. **RT-18B**：`user_agent` 列直接持久化请求头原样文本（仅截断 500），无任何形状检测；当前无读取端点返回它，但属 at-rest 敏感值留存。

同时验证了设计有效的一面：真实 query/fragment（RT-4/5）、http 形 userinfo（RT-12/X3）、malformed URL 的 query（RT-13/13B）都被剥离；CRLF/NUL 被 URL 解析规范化（RT-14）；500 截断边界生效（RT-15B/15C）；metadata 键黑名单与凭据形状检测有效（RT-16B-G、17C、18E）；timeline metadata allowlist 默认拒绝（未知事件名 metadata 为空）；audit_logs 与 server.log 无泄露；未指派 Proctor 读取被 404 拒绝。

风险定性：route/userAgent 是客户端任意声明的低信任自述数据（#544），暴露对象限于同组织 Admin/已指派 Proctor 与 DB at-rest；但在共享/被入侵客户端、或未来 logger 误发完整 URL 的现实场景下，上述通路构成敏感值（凭据、token、考试内容——path 内容无任何内容检测）真实落库与再暴露。
