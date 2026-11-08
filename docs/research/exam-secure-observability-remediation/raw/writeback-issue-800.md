# Issue #800 回写草稿 — secure-correlation 联合审计摘要（Observability V2 总台账）

> 状态：草稿，**不自动回写**。由发起方/Owner 决定摘录发布。
> 证据基线：master @ `423f2945d9feef73a5413e498fb2772cc245c754`（2026-11-07/08 审计；较评论[21] 台账基线 `77dfd505` 后又并入 #915/#916 命名重构——**预期无功能变更，属未核验假设**：按提交标题与 diffstat（29 files +127/−156）判断，未逐行核对，见 baseline/FACTS.md §1 不确定性标注）。

## 结论

针对 #800 关联性谱系的十线安全关联审计（基线冻结 → 源码测绘 → 外部实践 → 对抗实验 → 关联演练 → 性能基准 → 三官独立裁决）完成。总结论（三官 3:0 一致）：

- **授权与信任模型健全**：跨组织/跨考生/staff 冒用/枚举/三路径一致性全部 LIVE_VERIFIED 防御成立（113+ 探针 + 裁决官独立重放）；requestId 服务端 UUIDv4 + 拒入站头，伪造/冒充零影响。
- **一处隐私不变量被打破（唯一 REFUTED）**：#864 的 route pathname 投影存在三条已证实泄露通路（path 段 secret、编码走私 query、opaque-scheme 凭据/data: 载荷 + 原始 CRLF），at-rest 与已授权读取面双通道证实——**建议 #864 进入施工（864-B 封闭模板投影）**。
- **#865 建议重开（锁定 865-C 窄选项）**：其关闭裁决自设的重开条件被两份 post-close 实测证据满足（playbook 200 关联缺失 join 实测 + 响应头代价实测；外部五厂商实践为佐证背景非触发条件）。
- **性能无回归**：全部候选变体实测无可测开销，确定性代价封顶（响应头每响应头行恰 +53B=15+36+2 算术值；每请求均值中位 +52.0B 为另一统计口径，两口径之差非矛盾）。
- 调查工作流**维持现状 GO**（stdout/Pino + jq/时间窗/运维脚本）；新增只读索引/调查端点/管理 UI 全部 DEFER。

## 信任边界与权限风险

五域信任模型（TRUST-BOUNDARY-DAG.mmd，标 SV/LV/IV）：客户端全部输出按不可信声明处理（eventId/clientSeq/route/metadata/claimed requestId）→ nginx 边缘（默认 combined 访问日志记录完整请求行含 query，配置级证实）→ Fastify 铸造 requestId → org 谓词承担租户隔离的 PG 权威 → 投影即防线的读取面（allowlist default-deny / CSV 列投影 / 三标量聚合）。

**权限风险结论**：未发现独立的严重权限漏洞。三类权限域中，A（应用 HTTP 权限）全矩阵实测通过；B（DB 账号）为设计事实——单一 `exam` 账号无角色分离、org 隔离完全由 repository 谓词承担（本审计全部越权负例通过印证其有效性；如未来做多租户产品化需重新评估）；C（部署日志文件权限）**INFRA_ACCESS_NOT_VERIFIED**——建议在部署文档中显式化「stdout 读取授权 = 最小集合 + 访问可审计」（OWASP Logging 原则映射，见外部研究）。

**遗留风险清单**（非权限类，均已在终稿登记）：① route 三通路泄露（待 864-B；**存量已落库行遵循 #875 先例 30 天 retention 自然淘汰**，apps/api/src/plugins/clientEventRetention.ts:33，不做迁移/清洗，紧急时可一次性运维清除需单独授权）；② user_agent at-rest 原样（RT-18B）；③ 日志通道 URL-query 泄露面——pino 请求行携带原始 req.url 含 query（探针 LIVE 证实机制、当前无已知敏感流实例）；**reset-password/invite 的 token query 在 nginx 默认 combined access log 机制覆盖内**（deploy/nginx/web.conf 无 access_log 覆写，配置级证实；运行时落盘 INFRA_ACCESS_NOT_VERIFIED），**建议部署侧先行缓解**：web.conf 覆写 log_format 脱敏 $query_string 或对 /reset-password、/invite 关闭 access_log（属部署配置与 docs/deployment 契约改动，建议登记本 Issue follow-up 候选）；④ stale-dist 混跑致 proctor-events 500（可用性 fail-closed，建议 dist<src mtime 守卫）；⑤ 未测攻击面 U1–U6：**U1** CSV 导出公式注入、**U2** 生产模式限流行为、**U3** 监考分配撤销 TOCTOU、**U4** operationId 并发碰撞确定性、**U5** route 字段 Web UI 渲染面、**U6** stale-dist 构建卫生（=风险④，已证实一次真实事故）——完整定义与合成验证方向见 review/security.md §3（.tmp 内）。

## 依赖关系（对 #800 子 Issue 网与冻结条款的影响）

- **#864（OPEN/DEFER）**：gate(1) 已由本审计满足且结果为负例成立——建议推进施工（B 方案）；gate(2)（调查效用损失量化）仅约束 B vs C 选择，不阻塞 B vs D。
- **#865（CLOSED）**：触发其自设重开条款，重开范围锁定 865-C；865-D 维持 NO_GO（verbatim 重放结构性冲突）。
- **#860/ADR-025**：无需 superseding——865-C 的契约更新以 ADR-025 为权威（响应头成为身份对应第四载体）；`requestIdHeader:false`、身份种类分离、client_claimed 标注等条款全部保持。
- **#875/#888**：route「只存 pathname」的字面保证仍成立，但本审计证明其不足以达成 at-rest 凭据最小化控制目标——收敛方向归 #864（B 方案），不动 #875 的 sanitize 单一权威。
- **#861/#866**：WARN 单条语义、receipt 三标量摘要等冻结不动；并发归因 AMBIGUOUS 是既定三态语义非缺陷（停止清单第 4 条）。
- **重审触发器状态**：多实例部署、OTel 采纳、日志量/ID 碰撞可测量运维问题——三者均未出现，ADR-025 重审触发器未满足。

## 最终建议（最小修复顺序）

1. **#864 reality audit → 更新 issue 合同 → 864-B 施工**（唯一 REFUTED 不变量=在库隐私泄露；无迁移、无 wire 变更；模板表单一权威+漂移守卫+canary 回归验收）。
2. **#865 重开裁决（Owner）**：865-C（+8 行 onSend hook + 契约文字 + 全响应测试）或接受类 info 日志行替代项；二者都不触碰 receipt/audit/client_event。
3. **调查工作流维持现状**；过度工程停止清单 10 条生效（终稿 ARCHITECTURE-OPTIONS §5）。
4. 独立登记（不绑架上述顺序）：U6 stale-dist 构建卫生守卫；U1 CSV 公式注入合成验证。

## 关键证据摘录

- 授权：adminB（org B Admin）对 org A 全部证据端点 404、audit 列表 org 谓词零泄露、200 响应内容全 org B 化（72 探针，grep 零命中）；未分配 proctor 7 端点 404 反枚举 + LIST 空集；12 格×5 采样枚举不可区分。
- 泄露：已授权 proctor-events 响应原样返回 `/password-reset/EXAMAUDIT-CANARY-RT-3` 与走私 query（重放再证实 12 canary）。
- 关联：E1c 声明他人真实 requestId 零影响；跨重启唯一性——重启前日志已累计 489 个 distinct reqId、重启后新发 6 个请求产生 6 个新 reqId，**交集=0**（单日志跨 3 个进程代共 495 个 distinct reqId 零复用，correlation/pb-08-restart-raw.log）；7 次协议拒绝↔7 条 WARN 一一对应。
- 性能：A/B/C/D 四变体 12 配置中位 rps 185.2/187.6/188.3/187.7，B/D 每响应头行恰 +53B（respB 每请求均值中位 +52.0B，两口径之差为统计口径差异非矛盾）、C 零字节差；4 变体×4 场景×3 并发=48 配置格、每格 3 次重复共 144 条测量行（raw/bench.csv），裁决官独立重算 48 格聚合逐格全等（review/performance.md §1）。

## 复现命令

```bash
# 全套入口（环境与 DB 身份核验见 env/RUNBOOK.md）
bash .tmp/secure-correlation-audit/adversarial/f1-cross-org.sh        # 跨组织
node .tmp/secure-correlation-audit/adversarial/post-canaries.mjs      # route 金丝雀
node .tmp/secure-correlation-audit/canary/unit-normalize.mjs          # 单元级（生产代码文本）
bash .tmp/secure-correlation-audit/correlation/exp1-2.sh              # header 影响
bash .tmp/secure-correlation-audit/performance/scripts/run-bench.sh   # 4 变体基准
bash .tmp/secure-correlation-audit/adversarial/run-probes.sh          # 113 探针全套
```

## 证据持久位置说明

十份终稿交付物与全部原始证据位于仓库工作区 `.tmp/secure-correlation-audit/`（gitignored，不入版本控制，**无归档时限承诺——工作区清理后原始文件（bench.csv、canary dump、replay 输出等）将不可复核**）：终稿十份在根目录（BASELINE-AND-SOURCE-MAP / EXTERNAL-PRACTICES / TRUST-BOUNDARY-DAG / AUTHORIZATION-MATRIX / ADVERSARIAL-TEST-RESULTS / REQUEST-CORRELATION-MATRIX / PERFORMANCE-RESULTS / ARCHITECTURE-OPTIONS / INDEPENDENT-REVIEW / FINAL-VERDICT）；原始证据按 baseline/ source/ external/ adversarial/ correlation/ performance/ review/ 分目录；三份 Issue 回写草稿在 writeback/。**是否摘录关键部分入 #800 由人工决定**；建议最小摘录集 = FINAL-VERDICT.md §5 严格输出块 + 本草稿「结论」与「遗留风险清单」两段 + writeback/issue-864.md 攻击矩阵表（自包含可复核）；需长期保留 144 测点等原始数据时由发起方复制为 Issue 附件。本轮零产品改动（PRODUCT_CHANGES=NONE）、零 git 跟踪文件修改、不自动回写任何 Issue。
