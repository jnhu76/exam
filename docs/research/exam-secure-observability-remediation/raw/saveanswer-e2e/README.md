# raw/saveanswer-e2e — 清单与来源

本目录是 `SAVEANSWER-CORRELATION-E2E.md` 与 `FINAL-OWNER-DECISIONS.md` §3.3 的原始证据。

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `05-save-rejection-request-id.png` | 考生界面：真实 HTTP 200 `accepted:false` 后显示 `请求编号：e0289b97-f55e-4ee6-8864-6472faf51116` | `integration-final` @ `a84b416a`，M4 运行（2026-11-09 05:59 UTC+8） |
| `06-timeline-client-claimed-request-id.png` | 管理员时间线：`answer_autosave_failed` 行标注“客户端声明，未经服务端核验”，metadata 含同一 UUID | 同一 M4 运行 |
| `07-transport-unknown-no-request-id.png` | 传输失败：只有连接异常与保存失败提示，**无**请求编号（UNKNOWN 语义） | 同一 worktree，M5 运行（05:57 UTC+8） |
| `server-rejection-line.json` | 服务器 Pino WARN `"Answer save rejected"`，`reqId` 与 05/06 同一 UUID | M4 运行期间 `/tmp/e2e-wsl-api.log` |
| `run.txt` | 两次运行的命令、环境、结果、失败尝试与脱敏说明 | 本次编纂会话 |
| `m4-run.log` | M4 运行的完整 runner 输出（含 build、启动、Playwright 结果、EXIT=0） | 本次运行 `/tmp/m4-run3.log` 归档 |
| `m5-run.log` | M5 运行的完整 runner 输出 | 本次运行 `/tmp/m5-run2.log` 归档 |

校验和（供人工比对；最终 `SHA256SUMS` 由独立裁决员生成）：

```
1ba5ff29e06023a45866684266805f3ed8da14da2edbff21466bb602c10e1660  05-save-rejection-request-id.png
8e6fdbbac453842bd0a425cccfb775fd1a30070138ec1592e014d06c431f965b  06-timeline-client-claimed-request-id.png
b6a83f5638f8d31fdc3d601e8807333f20e9740981829dfc89d07ce73b4e7874  07-transport-unknown-no-request-id.png
fb62823b58eaef8d5b48bc71b5d6138242b3658310dedf368fd6fd224e4ed6ed  server-rejection-line.json
f1d5585d1b22bf32e63abfb557bd344625c65f5bcfa42aa0544da3527f5fd872  run.txt
aa620a77c06bb193a9c6c6d7cfe21d5f02a2f0ddd07b99bb2f9c81163c8f601e  m4-run.log
fc2f34c2afe07b9c4cb76d24aa6e6e662c2bd3b355aebe4de1fceb75d6e33cde  m5-run.log
```

（`README.md` 自身的校验和由收口时的 `SHA256SUMS` 统一生成，不在本文内自引用。）

## 边界

- 运行对象是 `a84b416a` 的产品代码 + 2 个**未提交**测试文件改动（M3 forged id
  改 UUID 形状；`crossOrg.test.ts` 5 行）。M4/M5 测试体不受影响。
- 截图是浏览器像素证据；DOM 断言（`toContain(headerRequestId)`）由通过的 M4 用例
  本身完成。
- 不含真实考生、真实答案、凭据或生产日志；seed 为合成数据。
