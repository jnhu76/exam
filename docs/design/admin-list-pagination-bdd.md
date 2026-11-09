# 管理列表分页、搜索与状态语义 — 行为契约与 BDD 规格（#785）

> Status: ACTIVE（承载 #785 的行为规格与验收场景映射）
> Baseline: master@`f94b519f4fd54ad7f3cfe7da85411d2b3fbdfa3c`
> 来源：#785（P1 缺陷：ExamPage / CandidatesPage / CoursePage / ResultsOverviewPage 只取默认第一页且无分页 UI）。

本文是 #785 施工合同的行为部分：先冻结业务语义，再映射到可执行测试。实现完成后，本文件描述的就是长期行为契约；过程性证据（RED/GREEN/mutant 记录）属于 PR 描述与 Git 历史，不进入本文。

## 1. 行为契约（六个权威问答）

### 1.1 用户可以访问哪些记录？

统一管道（与 #286 LIST scope 一致）：

```
Authorization/Tenant Scope → Search/Status Predicate → Stable Ordering (createdAt ASC, id ASC) → LIMIT/OFFSET
```

- Admin：组织内全部记录（org-wide）。
- Teacher：仅授权课程关联的记录（exams/candidates/courses 经 `resolveTeacherCourseScope`，SQL 侧 EXISTS，先于分页）；空授权集合 → 空列表、total=0。
- `GET /api/exams`、`GET /api/candidates`、`GET /api/courses`、`GET /api/questions` 全部真分页：任何授权可见记录都可经翻页到达。

### 1.2 搜索和筛选针对哪个数据全集？

数据库内授权全集（先谓词后分页），不是当前页。搜索/状态谓词在 SQL 的 `WHERE` 中、`LIMIT/OFFSET` 与 `COUNT` 之前生效；`items` 与 `total` 使用同一组 WHERE 条件。

### 1.3 `total` 代表什么？

`total` = 与列表完全一致的授权 + 搜索 + 状态过滤条件下的总行数（不受分页影响）。UI 禁止把“当前页条数”呈现为总数；`total` 只来自服务端响应。

### 1.4 何时重置页码？

| 触发 | 行为 |
| --- | --- |
| 修改搜索词（debounce 提交） | 重置到第 1 页 |
| 修改状态筛选 | 重置到第 1 页 |
| 翻页 | 保持搜索/状态条件 |
| 清空搜索 | 重置到第 1 页，恢复全集分页 |
| 删除后当前页越界（空页且 page>1） | 单跳到最后一个有效页 `max(1, ceil(total/pageSize))` 并重新查询；恢复期间渲染 Loading，绝不渲染空态或旧数据行 |
| 删除后当前页仍有数据 | 停留当前页并刷新 |

删除失败不改变页码、不重查询。

### 1.4.1 查询进行中的呈现（B12）

**查询条件与已加载数据绑定**：页面渲染的数据必须属于当前查询（page + search + statuses）。当已提交的查询与已加载的数据不一致（新请求在途）时，列表区渲染明确的 Pending 态：

- 不渲染旧查询的行（旧记录不得被呈现为新查询的结果，其行操作自然不可达）；
- 不渲染任何空态（空态只属于已加载完成的数据）；
- generation guard 继续保证只有最新请求可提交数据。

### 1.5 考试状态与查看成绩权限如何区分？

三个独立事实，互不替代：

- `status`：考试生命周期事实（`ExamStatusEnum`：draft/published/open/closed/canceled/archived）。
- `canViewScores`：成绩查看操作可用性事实，由服务端 `getScoreViewMeta` 通过共享 `resolveAdminResultsAccess` 依据状态、结束时间、已批改数量与未完成作答数量计算。
- `scoreViewDisabledReasonCode`：操作不可用原因（`EXAM_CANCELED` / `EXAM_NOT_FINISHED` / `UNRESOLVED_ATTEMPTS_EXIST` / `NO_GRADED_ATTEMPTS`），UI 用既有 i18n 键呈现。

成绩总览列表成员资格由状态集合决定（服务端过滤），操作可用性仅由 `canViewScores` 决定；`published ≠ 成绩可查看`，`closed ≠ 必定有成绩`。

**成绩总览默认状态集合（维持既有产品规则）**：包含 `published / open / closed / archived`；排除 `draft / canceled`。ExamPage 默认（不传 `statuses`）不做状态过滤，六种状态全可见。

### 1.6 数据创建、删除、状态变更后如何维持可达性？

- 排序恒为 `createdAt ASC, id ASC`：新建记录落在最后一页——通过真实翻页可达，禁止为此反转全局排序。
- 删除/编辑/导入/状态变更后按 §1.4 规则刷新当前视图。
- 请求竞态：同一列表的并发查询以 generation guard 序列化，仅最新请求可写 items/total/loading/error；过期响应不得覆盖新状态。
- 请求在途的呈现按 §1.4.1：旧数据不充当新查询结果（B12）。

### 1.7 API 查询参数契约（向后兼容扩展）

`PaginationParamsSchema` 全局语义不变（page 默认 1、pageSize 默认 20、上限 100）。

| 路由 | 新增可选参数 | 契约 |
| --- | --- | --- |
| `GET /api/exams` | `statuses` | 逗号分隔的 `ExamStatusEnum` 值，OR 语义；去重；缺省或空串 → 不过滤（兼容旧客户端）；含非法 token → 400 校验错误。`items` 与 `total` 同条件。响应字段不变。 |
| `GET /api/candidates` | `search` | 可选，≤200 字符；trim 后为空 → 不过滤；大小写不敏感子串匹配对应 User 的 `name` 与 `username`；参数化查询，先于 LIMIT/OFFSET 与 COUNT。响应字段不变。 |
| `GET /api/courses` | （既有）`search` | 搜索范围含 `name`、`code` 与 `description`（大小写不敏感子串；保持 #785 之前 Web 端客户端搜索的既有语义，见 B13）；≤200 字符；先于 LIMIT/OFFSET 与 COUNT。响应字段不变。 |

不合法 `pageSize`（>100、<1、非整数）与非法 `statuses`/超长 `search` → 既有 400 校验错误语义，不静默放宽。

## 2. BDD 场景矩阵

每行：`Scenario → Business Rule → API Contract → Repository Predicate → UI Observation → Executable Test`。

层级定义：

- **L1** = API/Repository 集成测试（真实 PostgreSQL，真实查询逻辑；`apps/api/src/routes/listPagination.contract.test.ts`）
- **L2** = Web 组件测试（mock API 但使用真实分页响应结构；`apps/web/src/pages/admin/*.test.tsx`）
- **L3** = 真实浏览器 + 真实 API/DB（`apps/e2e/e2e/admin-list-pagination.spec.ts`）

| ID | 业务规则 | API 契约 | Repository 谓词 | UI 观察 | 测试 |
| --- | --- | --- | --- | --- | --- |
| B01 | 超过第一页容量的记录仍可经翻页到达，总数如实 | `page=2` 返回第 21 条；`total=21`；响应结构不变 | `LIMIT/OFFSET` 于稳定排序 `createdAt,id` 之后 | 分页控件存在；第 2 页含第 21 条；统计显示真实 total；两页无重复遗漏 | L1（exams/candidates/courses 参数化 0/1/19/20/21/40/41）+ L2（ExamPage/CandidatesPage/CoursePage 翻页）+ L3 |
| B02 | 考生搜索在 DB 全集执行，不限于已加载页 | `?search=<kw>` 命中第 41 名；total=匹配数；无匹配 → 空 items、total=0；清空恢复全集 | `EXISTS(users WHERE lower(name/username) contains lower(term))` 于 LIMIT/COUNT 之前 | 第一页输入关键词即可命中；无匹配空态；清空恢复 | L1 + L2 + L3 |
| B03 | 课程搜索与分页组合，翻页保持搜索条件 | 既有 `search` 参数；total 反映搜索后总数 | 既有 `listFiltered` 谓词（name/code/description，见 B13） | 搜索 + 翻页条件保持；清空恢复 | L1 + L2 |
| B04 | 状态筛选先于分页；成绩总览不因第一页草稿出现假空态 | `?statuses=published,open,closed,archived` 服务端过滤；total=过滤后总数 | `inArray(status, …)` 于 LIMIT/COUNT 之前 | 成绩总览列出全部符合状态条件的考试（含 >20）；状态标签与 `status` 一致 | L1 + L2 + L3 |
| B05 | 状态标签与成绩查看权限相互独立 | 每项携带 `status`、`canViewScores`、`scoreViewDisabledReasonCode`，由服务端计算 | —（元数据由 route 计算层提供，非 repo） | 按钮可用性仅由 `canViewScores` 决定；禁用显示原因码对应文案；不因状态推断覆盖 | L1 + L2 + L3 |
| B06 | 状态过滤与分页组合；切换状态重置页码 | 六状态各跨分页边界时 `statuses` 仍返回该状态全集与正确 total | 同上；Admin/Teacher 同语义 | 选择状态后回到第 1 页；翻页保持状态；切回“全部”恢复全集 | L1 + L2 |
| B07 | 删除最后一条记录后回退到有效页 | —（列表重查询） | — | 第二页单条删除后**单跳**回最后一个有效页；恢复期间渲染 Loading，任何时刻不得出现假空态或已删除行；失败保持原页 | L2 |
| B08 | 搜索/筛选/翻页竞态下仅最新请求生效 | — | — | generation guard：旧响应不覆盖新数据；快速输入不产生无界请求（debounce） | L2 |
| B09 | 授权范围约束搜索/过滤/计数；无跨组织泄漏；多 enrollment 不产生重复 | 相同查询参数下 Admin/Teacher 结果不同；Teacher 空 scope → 空集 total=0 | 谓词与 scope EXISTS 组合于同一 WHERE；EXISTS 保证不重复 | —（服务端权威，UI 无角色分支） | L1（Teacher scope × search/status、跨组织隔离、多 enrollment 去重） |
| B10 | 旧客户端（无新参数）行为完全不变 | 缺省=page 1/pageSize 20/无状态过滤/原排序/原响应结构与错误语义 | 同 B01 | —（服务端契约） | L1（回归断言：缺省参数、非法 statuses=400、越界 pageSize=400） |
| B11 | 越界恢复期间不得出现虚假空态 | — | — | 空页响应（total>0 且 page>1）不提交渲染；单跳恢复期间 UI 停留在 Loading；已删除行也不得残留 | L2（deferred 响应编排） |
| B12 | 请求进行中，旧记录不得被呈现为新查询的结果 | — | — | 查询条件（filter/search/page）变更后、响应落地前：列表区渲染 Pending，旧行与其行操作不可见、不可点；不得出现任何空态 | L2（deferred 响应编排） |
| B13 | 课程描述搜索覆盖服务端全集（保持 #785 前客户端搜索语义） | `?search=` 命中仅 description 含关键词的记录；total 为匹配全集数 | `position(lower(term) in lower(name/code/description))` OR 谓词，于 LIMIT/COUNT 之前 | 搜索框输入描述关键词即命中；跨页匹配 total 正确 | L1 + L2 + L3 |

### 场景细化（Given/When/Then）

**B01_AllRecordsReachable**
- Given Admin 组织拥有 21 场考试（考生/课程同理），按 `createdAt ASC,id` 排序第 21 场在第二页
- When 打开列表并翻到第 2 页
- Then 第 21 条可见；total=21；两页并集=全集且无重复；点击详情正常；排序语义不变

**B02_SearchAcrossFullSet**
- Given 41 名考生，第 41 名 name/username 含唯一关键词
- When 在第 1 页输入该关键词
- Then 命中第 41 名；total=匹配数；无需先翻页；无匹配显示真实空态；清空恢复全集分页；大小写不敏感

**B03_CourseSearchPagination**
- Given >20 门课程，目标课程在第二页以后
- When 按名称/代码搜索并翻页
- Then 服务端全集搜索；total 反映搜索后总数；翻页不丢条件；清空恢复

**B04_StatusFilterBeforePagination**
- Given 40 场考试：前 20 场 draft，后 20 场为 published/open/closed/archived 混合
- When 打开成绩总览
- Then 列出全部 20 场符合条件的考试（不受 draft 挤占第一页影响）；total=20；分页基于过滤后结果集；状态标签与 status 一致

**B05_StatusVsScorePermission**
- Given published（未结束）、closed（无成绩）等状态与成绩准备情况不同的考试
- When 打开成绩总览
- Then 状态标签反映 status；按钮可用性仅由 canViewScores 决定；published 不等于可查看；closed 无成绩仍禁用并显示 `NO_GRADED_ATTEMPTS` 文案；考试已结束但仍有未完成作答时禁用并显示 `UNRESOLVED_ATTEMPTS_EXIST`（与 GET /scores 的 409 一致）；列表成员资格不受影响

**B06_StatusFilterPaginationCombo**
- Given 六种状态各有 >pageSize/2 条（跨分页边界）
- When 选择某状态并翻页，再切换状态
- Then 返回该状态授权全集；total 正确；状态切换重置第 1 页；旧响应不覆盖；切回全部恢复全集

**B07_DeleteLastItemOnPage**
- Given 用户在第 2 页，该页仅 1 条可删除记录
- When 删除成功
- Then 单跳回最后一个有效页（`ceil(total/pageSize)`，非逐页步退）；恢复期间渲染 Loading；无假空态；已删除行不残留；无重复请求循环
- When 删除失败
- Then 停留原页、原数据保留、显示错误

**B08_RaceConditions**
- Given 连续修改搜索词/状态/页码，旧请求未返回
- When 新请求先完成、旧请求后完成
- Then 最终 UI 只显示最新条件的数据；items/total 不混用；loading/error 不被过期请求覆盖；输入由 debounce 收敛

**B09_ScopeCombination**
- Given Admin、Teacher（授权课程 A）与另一组织的数据
- When 相同 search/statuses/分页参数查询
- Then 各自仅在授权范围内匹配与计数；Teacher 空 scope → 空集；跨组织记录不泄漏；多 enrollment 考生不重复计数

**B10_BackwardCompat**
- Given 客户端不带新增参数
- When 调用三个列表 API
- Then 默认 page=1/pageSize=20；响应结构与字段名不变；排序不变；无隐式状态过滤；非法 statuses/越界 pageSize → 400，不放宽为全量

**B11_RecoveryNeverShowsFakeEmpty**
- Given 第 3 页仅 1 条记录，删除后服务端返回 `items=[]、total=40`（有效页为第 2 页）
- When 删除成功、恢复查询在途
- Then UI 任何时刻不渲染空态（“暂无 X”/“未找到匹配”），不渲染已删除行；恰好发起一次 `page=2` 的恢复查询（单跳，非逐页步退）；恢复数据落地后渲染第 2 页行与真实 total

**B12_InFlightStaleNeverPresentedAsResult**
- Given 列表已显示 A 条件的行，用户提交 B 条件（状态筛选/搜索）
- When B 查询在途（响应被延迟）
- Then 列表区渲染 Pending 态：A 的行与其行操作不可见、不可点；不出现任何空态；B 响应落地后仅显示 B 的行
- When B 查询失败
- Then 显示错误态并可重试，不把 A 的行冒充为 B 的结果

**B13_DescriptionSearchCoversFullSet**
- Given 40 门课程，其中 25 门仅 description 含关键词（name/code 均不含），且匹配跨分页边界
- When `?search=<关键词>`（或在搜索框输入）
- Then total=25；两页并集=匹配全集；仅 name/code 含关键词的记录不因描述误命中；清空恢复全集

## 3. 反事实（Mutant）Oracle

| Mutant | 注入点 | 应被杀死的场景 |
| --- | --- | --- |
| M-UI-1 | 页面回退为始终请求第 1 页（删除分页参数传递） | B01（L2/L3） |
| M-SQL-1 | 搜索/状态谓词移到 LIMIT/OFFSET 之后（先分页再过滤） | B02/B04/B06（L1） |
| M-COUNT-1 | `total` 改为 `items.length`（或 COUNT 丢掉谓词） | B01/B02/B04（L1/L2） |
| M-PERM-1 | UI 以 `status` 推断替代 `canViewScores` 决定按钮 | B05（L2/L3） |

每个 mutant 隔离注入、记录失败证据、完整撤回；不进入最终提交。
