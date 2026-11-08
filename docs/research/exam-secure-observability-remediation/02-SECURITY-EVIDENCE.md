# 对抗测试结果（ADVERSARIAL-TEST-RESULTS）

- 轮次：secure-correlation-audit（终稿交付物 5/10）
- 汇总来源：`adversarial/canary-matrix.md`（#864 route 金丝雀矩阵）+ `adversarial/authz-tenant.md` + `adversarial/authz-proctor-admin.md`（授权攻击族 1–9）+ `review/security.md`（裁决官独立重放 R1–R6）。
- 全部实验于 2026-11-07/08 在共享审计环境执行（API localhost:3000 APP_MODE=e2e，DB `exam_ci_audit` 身份核验先行，psql 只读）；金丝雀全部为合成 `EXAMAUDIT-CANARY-*`，无真实用户数据；git 跟踪文件零改动。

## 1. 金丝雀分类图例

原样持久化＝DB 中出现未编码金丝雀字节；编码持久化＝出现百分号编码形态（注明解码次数可还原）；脱敏后持久化＝值被替换/剥离；读取端再暴露＝调查端点响应中出现；服务端拒绝＝4xx 且值未回显。

## 2. route 投影金丝雀矩阵（#864 核心证据；单元级执行的是**生产代码文本本身**——从 clientEvents.ts 逐字提取 normalizeRouteForStorage，sha256 快照 `2b63c772…`；HTTP 级 31 事件一次 POST 200 accepted:31）

| # | 用例 | 投放 route / 载体 | normalizeRouteForStorage 输出（=DB route 列） | 分类 | timeline 再暴露 |
|---|---|---|---|---|---|
| RT-1/2/2B | 正常 SPA 路由 / UUID path / 非 UUID opaque ID | `/exams/<canary>` 等 | 原样 | 原样持久化（设计内） | 是 |
| **RT-3** | **token 在 path** | `/password-reset/EXAMAUDIT-CANARY-RT-3` | 原样 | **原样持久化（真实泄露反例）** | **是** |
| RT-4/5 | token 在 query / fragment | `/exam/list?token=…` / `#token=…` | `/exam/list` | 脱敏后持久化 | 否 |
| RT-6/7 | 百分号编码 / 双重编码 | `/reset/%45%58…` | 编码形态保留 | 编码持久化（1–2 次解码还原） | 是 |
| **RT-8** | **编码 ?/=/ 走私 query** | `/a%2Fb%3Ftoken%3D…` | 金丝雀明文+走私结构完整保留 | **编码持久化，单次解码即得完整 query** | **是** |
| RT-9 | Unicode 路径 | `/考试/…` | `/%E8%80%83…` | 编码持久化（1 次解码还原） | 是 |
| RT-10 | 大小写变化 | — | 原样 | 原样持久化 | 是 |
| RT-11 | 绝对 URL | `http://client.example/exam/<canary>?token=…#f` | `/exam/<canary>`（query/frag 剥离，path 保留） | path 段原样持久化 | 是 |
| RT-12 | userinfo（http 形） | `http://user:pass@…/path` | `/path` | 脱敏后持久化 | 否 |
| **RT-12B** | **opaque-scheme userinfo** | `user:SECRET@example.com/path` | `SECRET@example.com/path` | **原样持久化（URL 解析器 quirk：非特殊 scheme opaque path 含凭据）** | **是** |
| **RT-12C** | data: URL | `data:text/html,<canary>` | `text/html,<canary>` | **原样持久化（opaque path 整体保留）** | **是** |
| RT-13/13B | malformed URL | `http://[?token=…` | fallback 在 `?` 截断 | 脱敏后持久化 | 否 |
| RT-14 | CRLF/NUL 控制字符 | — | CRLF 被 URL 解析移除、NUL→%00 | 脱敏后持久化 | 否 |
| **RT-14B** | **malformed+原始 CRLF** | `http://[\r\n<canary>?x=y` | **原始 CR/LF 字节入库**（fallback 分支不清洗） | **原样持久化**（timeline JSON 中 `\r\n` 转义，无日志注入） | **是** |
| RT-15/15B/15C | 长度边界 | 499/326→900+编码字节/1124 字符 | 全长保留 / 截断 500（编码序列中段截断） / 截断 500 | 截断边界生效 | 部分 |
| RT-16A | metadata 无害键+普通敏感值 | `{note:"…plainsecret"}` | 原样（#875 明示非目标）；timeline 不暴露（name 不在 allowlist） | 原样持久化 | 否 |
| RT-16B–G | 凭据形状值/黑名单键 | Bearer/JWT/password/answer/message/url | 全部 `[redacted]` | 脱敏后持久化 | 否 |
| RT-17 | 嵌套+字符串数组 | — | 17A/17B/17D 原样、17C（键 token）redacted | 原样持久化；timeline 不暴露 | 否 |
| RT-18A | 超长 route 400 | 501 字符 | HTTP 400，值未回显 | 服务端拒绝 | 否 |
| **RT-18B** | **User-Agent 头携带** | `user-agent: …RT-18B` | 31/31 行 `user_agent` 列原样（仅 500 截断、无形状检测） | **原样持久化（at-rest）**；当前无读取端点返回 | 否 |
| RT-18C | name 通道 | `EXAMAUDIT-CANARY-RT-18C` | 原样（≤120 机器标识符通道） | 原样持久化 | 是（name 字段） |
| RT-18D/E | clientSessionId 普通/JWT 形 | — | 原样 / `[redacted]` | 按形状 | 否 |

### 读取面汇总（canary 出现位置）

| 读取面 | 金丝雀出现 | 证据 |
|---|---|---|
| POST /client-events HTTP 响应 / 400 错误体 | 否（值不回显） | post-canaries.out.txt |
| client_events 表（route/metadata/name/user_agent/client_session_id） | 是（见矩阵） | db-route-dump.txt、db-metadata-dump.txt、db-form-scan.txt、db-per-event-classification.txt |
| server.log（Pino 全文）/ audit_logs | **0 处** | serverlog-scan.txt、db-form-scan.txt 第二段 |
| Proctor timeline（已指派 proctorA1） | **12 行**（11 行 route 原样 + 1 行 name）；metadata 全部 `{}` | timeline-proctorA1.json + 裁决官重放 review/replay-timeline-proctorA1.json（今日再暴露 12 canary） |
| 未指派 proctorA2 / Admin audit timeline | 404 / 0 处 | readside-checks.out.txt |
| CSV export（scores） | 线上最初 409（无已评分 attempt）→ 裁决官重放时 200：CSV 7 列，无标准答案、无 metadata/route，0 canary | readside-checks.out.txt、review/replay-readside-checks.out.txt、f9-scores-export-admin.csv |

### 泄露反例结论（LIVE_VERIFIED，双通道 = at-rest + 读取面再暴露）

**存在三条真实泄露通路**：①RT-3/RT-8（path 段 secret 或编码走私 query 原样/单次解码可还原落库并经已授权 proctor-events 原样返回——一个把 `encodeURIComponent(location.href)` 当 route 发送的 buggy sender 会把整条 query 含 token 送入库）；②RT-12B/12C（非特殊 scheme opaque path 使 `scheme:SECRET@host` 凭据与 `data:` 载荷成为「pathname」，metadata 通道有 containsUserinfoUrl 检测而 route 通道没有等价防线）；③RT-18B（user_agent 头原样 at-rest）。同时验证了设计有效面：query/fragment/http-userinfo/malformed-query 剥离、CRLF 规范化、500 截断、metadata 键黑名单与凭据形状检测、timeline allowlist 默认拒绝、audit_logs 与 server.log 零泄露、未指派 404。

## 3. 攻击结果索引（授权族 1–9 + 关联实验，全 LIVE_VERIFIED；详见 AUTHORIZATION-MATRIX.md）

| 族 | 攻击面 | 结果 | 证据 |
|---|---|---|---|
| 1 | 跨组织（adminB/candB1 → org A 9 端点） | 全 404；audit 列表 org 谓词零泄露 | run-01 + replay-f1 |
| 2 | 同 org 考生互读/互写 | 全 404 反枚举；DB 终态零污染 | run-02、run-02b |
| 3 | 未分配监考 × 7 scoped 端点 + 2 LIST | 404 反枚举 + LIST 空集（41 探针） | raw/f3-proctor-boundary.txt |
| 4 | 高权限面实际 Permission（12 端点 × 5 主体） | 按 capability 裁决；adminB 200 内容全 org B 化（72 探针） | raw/f4-permission-gate.txt |
| 5 | 资源枚举（12 格 × 5 采样） | 状态/码/字节/耗时全不可区分 | run-05-enumeration.txt |
| 6 | client_events 冒用引用 | 信任边界折叠全 NULL/staff 无例外/去重按 (org,user) 隔离/无存在 oracle | run-06-07 + replay-f6 |
| 7 | 客户端自报 requestId（header+遥测双通道） | header 被忽略不改授权结论；遥测声明只落自己行且 attempt_id NULL（结构上不可能进受害者时间线） | run-06-07 §7.1、header-influence.md E1a–f |
| 8 | 同数据三路径一致性 | allow/deny 一致，无弱路径 | raw/f8-consistency.txt |
| 9 | 投影差异泄露 | 各投影面字段集与源码声明一致；白名单丢弃超集键；CSV 无 JSON 面 PII 列 | raw/f9-* |
| — | proctor-events 500 | **唯一 REFUTED（可用性）**：stale dist 根因，fail-closed 无泄露；裁决官复查已恢复 200 | run-07b–07f、raw/f9-500-*、review R2/R6 |

裁决官独立重放矩阵（review/security.md §1）：R1 跨组织（一致）、R2 读取面再暴露+分配门（一致，12 canary 再证实；scores CSV 409→200 为环境状态演化非矛盾）、R3 route at-rest（31 行一致）、R4 伪造头（一致，grep=0）、R5 引用信任 DB 终态（一致）、R6 500 根因（dist 已含 to_char 修复）。**重放未发现原始证据链之外的越权/泄露反例**。

## 4. 复现命令

```bash
# route 金丝雀（单元级=生产代码文本；HTTP 级=真实 server+PG）
node .tmp/secure-correlation-audit/canary/unit-normalize.mjs        # → canary/unit-normalize.out.txt
node .tmp/secure-correlation-audit/adversarial/post-canaries.mjs    # → post-canaries.out.txt / .run.txt
# at-rest 复核（只读）
docker exec exam-dev-db-1 psql -U exam -d exam_ci_audit -c \
 "SELECT event_id, left(route,80), length(route) FROM client_events WHERE event_id LIKE 'rtcanary-%' ORDER BY event_id"
# 读取面再暴露（已指派 proctor token 在 env/proctorA1.token）
curl -s -H "cookie: auth-token=$(cat .tmp/secure-correlation-audit/env/proctorA1.token)" \
 http://localhost:3000/api/admin/attempts/f665c325-f4a1-4547-89f5-5aa97bea026e/proctor-events | jq '.items[].route'
# 伪造关联头
curl -s -D - -o /dev/null -H 'x-request-id: EXAMAUDIT-CANARY-HDR-xrequestid-2222' \
 -H 'request-id: EXAMAUDIT-CANARY-HDR-requestid-1111' http://localhost:3000/api/EXAMAUDIT-CANARY-NOSUCHROUTE
# 500 根因复现（离线）
node --import tsx .tmp/secure-correlation-audit/adversarial/repro5-projection.mts   # apps/api cwd
```

证据持久位置：`.tmp/secure-correlation-audit/adversarial/`（含 raw/ 子目录）与 `review/replay-*`——全部位于仓库工作区 gitignored 路径，本轮不自动回写 GitHub。
