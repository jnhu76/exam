# 形式化模型代理规则

本文件对 `formal/` 下的所有修改生效。形式化模型是可执行的一致性证据，不是第二份架构文档，也不是生产二进制的分发位置。根目录 `AGENTS.md` 同时适用。

## 禁止事项

- 禁止提交 TLC 状态目录、trace、checkpoint、dump 或 `formal/.work/` 内容；以 `formal/.gitignore` 为准。
- 禁止 vendoring `tla2tools.jar`、Toolbox、Java/TLA+ 二进制或运行时；runner 从环境变量 `TLA2TOOLS_JAR` 读取工具。
- 禁止为了让属性通过而静默扩大模型、放宽动作或削弱 invariant。新增状态变量、动作或常量必须说明状态空间影响。
- 禁止删除 expected-counterexample 配置。负向配置是模型确实覆盖目标 Bug 类的重要证据。
- 禁止把随机 simulation 描述成穷尽验证；目标 safety 配置必须按其声明的方式由 TLC BFS 检查。
- 禁止猜测 checksum；工具链校验值必须来自官方发布或明确标注为本地计算。
- 禁止把抽象模型检查描述成对 TypeScript/运行时代码的形式化证明。

## 建模约束

- TLC 行为、选项、配置格式、liveness、公平性和工具分发必须以官方 TLA+ 文档为依据；已采用的来源记录在 `tla/TOOLCHAIN.md`。
- 常量和集合保持有限。无界整数、时间戳、队列或请求 ID 空间不得未经设计进入目标模型。
- Safety 与 liveness 分开检查；公平性假设必须显式写入模型 README，并说明结论依赖哪些环境进展条件。
- 修改动作后必须重跑正向模型与相应 expected-negative 配置，确认反例仍命中预期的命名属性。
- 生产协议或 Accepted ADR 变化时同步核对模型；发现差异要诚实记录，不能扭曲模型去迎合已知实现缺陷。
- 不为形式上的覆盖率制造大而空的模型；选择能捕获承重竞态的最小协议。

## 与生产代码的边界

形式化模型任务默认只修改：

```text
formal/**
scripts/formal/**
package.json 中的形式化验证脚本
与该模型直接对应的架构、ADR、模型说明和证据文档
```

除非任务得到单独的生产修复授权，否则不得修改 `apps/**`、`packages/**`、数据库 Schema、API route、运行时契约或生产测试。

如果模型发现生产缺陷：

1. 保留最小反例；
2. 标明被违反的 invariant 和运行时差异；
3. 建议独立的生产修复任务及回归测试；
4. 不在形式化模型 PR 中静默修复生产行为。

## 工具链与交付

修改 Java、TLC runner、Docker、pnpm、Node、CI 或工具链版本前，先检查本地接线，再查对应版本的官方文档。不得凭记忆猜测 JVM/TLC 参数。

完成时报告实际运行的 safety、liveness、counterexample 和 runner 自测命令；未执行或环境缺失的门禁标记为 `SKIPPED`，不得声称通过。
