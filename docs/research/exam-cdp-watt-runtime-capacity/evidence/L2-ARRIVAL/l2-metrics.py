#!/usr/bin/env python3
"""L2-ARRIVAL per-run 指标提取（RESEARCH ONLY，协议 §6 L2 行 + §5 口径）。

从 run 目录原始产物计算（不改变任何原始数据）：
  samples.jsonl / driver.json / run-meta.json / schedule.jsonl（driver 侧）
  api-sampler.jsonl / api-summary.json / api-research-snapshots.jsonl（API 侧仪表）
  oracle.json（driver oracle.ts）/ db-oracle.json（psql 计数）

输出 <run-dir>/l2-metrics.json。口径：
  - login 首次点击→成功 = kind=login 且 verified 的 latencyMs（driver 侧
    sent→完整响应；判据 login-200+cookie+role，必要非充分由 oracle 复核）。
  - 独立成功人数 = DB login.success distinct（db-oracle）为主，driver
    sessionValid 为旁证。
  - 拒绝分类按 §5.2：429/401/503/网络层(timeout|ECONN*)/driver 丢样/取消。
  - “最后一人完成时间” = 窗口起点（首个到达计划时刻 + WARMUP 2500ms）
    到最后一个 login 成功响应；另报最后一个 verified op（流程收尾）。
  - 进行中考生的保存/心跳 p99 = verified save/heartbeat 的 latencyMs 分布
    （同报 p50/p95/max/N 与失败数）；按窗口内（≤240s）与窗口后拆分。
  - CPU/成功 分子 = 采样窗口内 API 进程 /proc utime+stime 增量（ms），
    分母 = DB oracle 独立成功登录人数（§5.3）。
"""
import json
import sys
from pathlib import Path

WARMUP_MS = 2500  # driver.mjs 默认 warmup-ms（run.sh 未覆盖）


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    idx = min(len(sorted_vals) - 1, int(p / 100 * len(sorted_vals)))
    return sorted_vals[idx]


def dist(vals):
    if not vals:
        return {"n": 0, "p50": None, "p95": None, "p99": None, "max": None}
    s = sorted(vals)
    return {
        "n": len(s),
        "p50": pct(s, 50),
        "p95": pct(s, 95),
        "p99": pct(s, 99),
        "max": s[-1],
    }


def load_jsonl(path):
    rows = []
    if path.exists():
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return rows


def main():
    run_dir = None
    for a in sys.argv[1:]:
        if a.startswith("--run-dir="):
            run_dir = a.split("=", 1)[1]
        elif a == "--run-dir":
            run_dir = sys.argv[sys.argv.index("--run-dir") + 1]
    if not run_dir:
        print("usage: l2-metrics.py --run-dir=<dir> | --run-dir <dir>", file=sys.stderr)
        sys.exit(2)
    run_dir = Path(run_dir)
    samples = load_jsonl(run_dir / "samples.jsonl")
    driver = json.loads((run_dir / "driver.json").read_text()) if (run_dir / "driver.json").exists() else {}
    dmeta = json.loads((run_dir / "run-meta.json").read_text()) if (run_dir / "run-meta.json").exists() else {}
    if not dmeta and (run_dir / "l2-run-meta.json").exists():
        dmeta = json.loads((run_dir / "l2-run-meta.json").read_text())
    oracle = json.loads((run_dir / "oracle.json").read_text()) if (run_dir / "oracle.json").exists() else {}
    dboracle = json.loads((run_dir / "db-oracle.json").read_text()) if (run_dir / "db-oracle.json").exists() else {}
    api_summary = json.loads((run_dir / "api-summary.json").read_text()) if (run_dir / "api-summary.json").exists() else {}
    api_ticks = load_jsonl(run_dir / "api-sampler.jsonl")
    snaps = load_jsonl(run_dir / "api-research-snapshots.jsonl")
    cands = json.loads((run_dir / "candidates.json").read_text()) if (run_dir / "candidates.json").exists() else {}

    n_planned = len(cands.get("candidates", [])) or dmeta.get("n")

    # ── login（首次点击→成功） ────────────────────────────────────────────
    logins = [s for s in samples if s.get("kind") == "login"]
    login_ok = [s for s in logins if s.get("verified") is True]
    login_lat = [s["latencyMs"] for s in login_ok if s.get("latencyMs") is not None]
    login_bad = [s for s in logins if s.get("verified") is not True]
    login_status = {}
    for s in logins:
        k = str(s.get("status"))
        login_status[k] = login_status.get(k, 0) + 1

    # ── 拒绝分类（§5.2，仅未通过判据的 op） ────────────────────────────────
    # verified=true 的 op 不算拒绝（含 me 的设计内预期 401：verifyKind=me-401-expected）。
    rej = {
        "http429": 0, "http401": 0, "http503": 0, "httpOther4xx5xx": {},
        "networkTimeout": 0, "networkOther": {}, "noResponse": 0,
        "cancelledDepFailed": 0, "driverDropped": 0, "designedAbortReplay": 0,
    }
    for s in samples:
        if s.get("verified") is True:
            continue
        kind = s.get("kind") or ""
        st = s.get("status")
        ec = s.get("errorClass")
        det = s.get("detail") or ""
        if "canceled" in kind:
            rej["designedAbortReplay"] += 1  # flow-B 刷新中止 in-flight 遥测（设计内）
            continue
        if det.startswith("cancelled:dep-failed"):
            rej["cancelledDepFailed"] += 1
            continue
        if det.startswith("driver-error") or det.startswith("never-completed"):
            rej["driverDropped"] += 1
            continue
        if st is None:
            rej["noResponse"] += 1
            continue
        st = int(st)
        if st == 429:
            rej["http429"] += 1
        elif st == 401:
            rej["http401"] += 1
        elif st == 503:
            rej["http503"] += 1
        elif st == 0:
            if ec == "timeout":
                rej["networkTimeout"] += 1
            elif ec:
                rej["networkOther"][ec] = rej["networkOther"].get(ec, 0) + 1
        elif st >= 400:
            rej["httpOther4xx5xx"][str(st)] = rej["httpOther4xx5xx"].get(str(st), 0) + 1

    # ── 完成时间（相对窗口起点 = WARMUP） ────────────────────────────────
    window_start = WARMUP_MS
    last_login_ok = max((s["responseAtMs"] for s in login_ok if s.get("responseAtMs") is not None), default=None)
    verified_ops = [s for s in samples if s.get("verified") is True and s.get("responseAtMs") is not None]
    last_op_ok = max((s["responseAtMs"] for s in verified_ops), default=None)
    submits = [s for s in samples if s.get("kind") == "submit" and s.get("verified") is True and s.get("responseAtMs") is not None]
    last_submit_ok = max((s["responseAtMs"] for s in submits), default=None)
    after = lambda v: (v - window_start) if v is not None else None

    # ── 进行中考生的保存/心跳（与其它 op 一并给出） ──────────────────────
    def opdist(kind_pred, window_end_ms=None):
        rows = [
            s for s in samples
            if kind_pred(s.get("kind"))
            and s.get("verified") is True
            and s.get("latencyMs") is not None
            and (window_end_ms is None or (s.get("responseAtMs") or 0) <= window_end_ms)
        ]
        fails = sum(
            1 for s in samples
            if kind_pred(s.get("kind")) and s.get("verified") is not True
        )
        return dist([s["latencyMs"] for s in rows]), fails

    win_end = window_start + int(dmeta.get("windowMs", 240000))
    kinds = {
        "saveAll": lambda k: isinstance(k, str) and k.startswith("save:"),
        "save1": lambda k: k == "save:1",
        "save2": lambda k: k == "save:2",
        "heartbeat": lambda k: k == "heartbeat",
        "start": lambda k: k == "start",
        "take": lambda k: k == "take",
        "submit": lambda k: k == "submit",
        "clientEvents": lambda k: isinstance(k, str) and k.startswith("client-events") and "canceled" not in k,
    }
    inprog = {}
    for name, pred in kinds.items():
        d_all, f_all = opdist(pred)
        d_win, f_win = opdist(pred, win_end)
        inprog[name] = {"runWide": d_all, "failures": f_all, "withinArrivalWindow": d_win}

    # ── 到达表形状（实际发射宽度；P3 平台窗口量化） ──────────────────────
    login_planned = [s.get("plannedAtMs") for s in logins if s.get("plannedAtMs") is not None]
    early = [s.get("sentAtMs") for s in samples if (s.get("plannedAtMs") or 1e9) <= 50 and s.get("sentAtMs") is not None]
    arrival = {
        "loginPlannedFirstMs": min(login_planned) if login_planned else None,
        "loginPlannedLastMs": max(login_planned) if login_planned else None,
        "sameMomentActualEmitWidthMs": (max(early) - min(early)) if len(early) > 1 else (0 if early else None),
    }

    # ── API CPU/资源（对齐 driver 窗口：[startedAt+2000, 最后响应]） ─────
    driver_epoch0 = dmeta.get("startedAt")
    if not driver_epoch0:
        # run-meta 缺失时的确定性重建：plannedEpoch = T0_EPOCH + plannedOffsetMs
        pe = [s["plannedEpoch"] - s["plannedAtMs"] for s in samples
              if s.get("plannedEpoch") and s.get("plannedAtMs") is not None]
        if pe:
            from datetime import datetime, timezone
            driver_epoch0 = datetime.fromtimestamp(min(pe) / 1000.0, tz=timezone.utc).isoformat()
    api_cpu = {"procCpuMsWindow": None, "mainThreadCpuMsWindow": None, "wallMsWindow": None,
               "cpuPerSuccessMs": None, "vmHwmKb": api_summary.get("vmHwmKb"),
               "busyThreadsMax": api_summary.get("busyThreadsMax"),
               "busyThreadsNonMainMax": api_summary.get("busyThreadsNonMainMax"),
               "hostCpuMsWindow": None}
    el = {"p90MaxMs": None, "maxMs": None, "snapshots": 0}
    if api_ticks and driver_epoch0:
        from datetime import datetime, timezone
        t0 = datetime.fromisoformat(driver_epoch0.replace("Z", "+00:00")).timestamp()
        win_lo = t0 + 2.0
        win_hi = t0 + ((last_op_ok or 0) / 1000.0) + 1.0
        sampler0 = None
        if api_summary.get("windowStartIso"):
            sampler0 = datetime.fromisoformat(api_summary["windowStartIso"].replace("Z", "+00:00")).timestamp()
        in_win = []
        for t in api_ticks:
            if sampler0 is None:
                continue
            epoch = sampler0 + t["tMs"] / 1000.0
            if win_lo <= epoch <= win_hi and t.get("procTicks") is not None:
                in_win.append(t)
        if len(in_win) >= 2:
            a, b = in_win[0], in_win[-1]
            api_cpu["procCpuMsWindow"] = (b["procTicks"] - a["procTicks"]) * 10
            api_cpu["mainThreadCpuMsWindow"] = (
                (b["mainTicks"] - a["mainTicks"]) * 10
                if a.get("mainTicks") is not None and b.get("mainTicks") is not None else None
            )
            api_cpu["wallMsWindow"] = b["tMs"] - a["tMs"]
            if a.get("hostTicks") is not None and b.get("hostTicks") is not None:
                api_cpu["hostCpuMsWindow"] = (b["hostTicks"] - a["hostTicks"]) * 10
    if snaps and driver_epoch0 and api_summary.get("windowStartIso"):
        from datetime import datetime
        t0 = datetime.fromisoformat(driver_epoch0.replace("Z", "+00:00")).timestamp()
        sampler0 = datetime.fromisoformat(api_summary["windowStartIso"].replace("Z", "+00:00")).timestamp()
        win_lo, win_hi = t0 + 2.0, t0 + ((last_op_ok or 0) / 1000.0) + 1.0
        p90s, maxs = [], []
        for s in snaps:
            epoch = sampler0 + s["tMs"] / 1000.0
            if win_lo <= epoch <= win_hi:
                ev = (s.get("process") or {}).get("eventLoop") or {}
                if ev.get("p90Ms") is not None:
                    p90s.append(ev["p90Ms"])
                if ev.get("maxMs") is not None:
                    maxs.append(ev["maxMs"])
        el = {"p90MaxMs": max(p90s) if p90s else None,
              "maxMs": max(maxs) if maxs else None,
              "snapshots": len(p90s)}

    # 独立成功人数（DB oracle 权威）
    indep = dboracle.get("loginSuccessDistinctCandidates")
    if indep is None and oracle:
        indep = (oracle.get("loginAudit") or {}).get("distinctCandidates")
    if api_cpu["procCpuMsWindow"] is not None and indep:
        api_cpu["cpuPerSuccessMs"] = round(api_cpu["procCpuMsWindow"] / indep, 1)

    # ── T6（driver 余量） ────────────────────────────────────────────────
    dcpu = driver.get("driverCpu") or {}
    lag = ((driver.get("sendLag") or {}).get("emitOnly")) or {}
    dropped = driver.get("driverDropped")
    t6 = {
        "driverCpuMax1Core": dcpu.get("cpuUsagePctMax1Core"),
        "driverCpuAvg1Core": dcpu.get("cpuUsagePctAvg1Core"),
        "emitLagP99Ms": lag.get("p99Ms"),
        "emitLagMaxMs": lag.get("maxMs"),
        "emitLagOver50": lag.get("over50ms"),
        "dropped": dropped,
        "verdict": None,
        "notes": [],
    }
    v = []
    if dropped not in (0, None):
        v.append("FAIL-dropped")
    if (dcpu.get("cpuUsagePctMax1Core") or 0) >= 600:  # 30% of 20-core host, 1-core scale
        v.append("FAIL-driverCpu")
    if (lag.get("p99Ms") or 0) > 50:
        v.append("LAG-EXCEEDED")
        t6["notes"].append(
            "emit-lag p99>50ms；对照 G1-BURST-CEILING-witness：Docker Desktop vpnkit 网桥同刻发射 ~1 op/ms 平台序列化"
            "（4 进程分片不改善、driver 同步发射段 ~9ms/200op、CPU<40% 单核）——非 driver 饱和；"
            "P3 大 N 的『同刻』有效宽度见 arrival.sameMomentActualEmitWidthMs"
        )
    t6["verdict"] = "PASS" if not v else ("PASS-WITH-PLATFORM-LAG" if v == ["LAG-EXCEEDED"] else "FAIL")

    metrics = {
        "runId": dmeta.get("runId") or (run_dir.name),
        "profile": dmeta.get("profile"),
        "n": n_planned,
        "scenario": dmeta.get("scenario"),
        "topology": dmeta.get("topology"),
        "fourLevel": driver.get("fourLevelCounts"),
        "offered": driver.get("offered"),
        "sent": driver.get("sent"),
        "login": {
            "offered": len(logins),
            "ok": len(login_ok),
            "failedOrRejected": len(login_bad),
            "statusTally": login_status,
            "latencyOk": dist(login_lat),
            "independentSuccessDbOracle": indep,
            "independentSuccessDriverSessionValid": driver.get("login", {}).get("independentSuccessfulCandidates"),
            "lastOkAfterWindowStartMs": after(last_login_ok),
        },
        "rejections": rej,
        "completion": {
            "lastLoginOkAfterWindowStartMs": after(last_login_ok),
            "lastSubmitOkAfterWindowStartMs": after(last_submit_ok),
            "lastVerifiedOpAfterWindowStartMs": after(last_op_ok),
        },
        "inProgressOps": inprog,
        "arrival": arrival,
        "apiCpu": api_cpu,
        "eventLoop": el,
        "t6": t6,
        "oracle": {
            "attempts": (oracle.get("attempts") or {}),
            "invariants": (oracle.get("invariants") or {}),
            "dbOracle": dboracle,
        },
    }
    out = run_dir / "l2-metrics.json"
    out.write_text(json.dumps(metrics, indent=2) + "\n")
    print(f"[l2-metrics] {metrics['runId']}: login ok={metrics['login']['ok']}/{len(logins)} "
          f"indep={indep} p99={metrics['login']['latencyOk']['p99']}ms "
          f"save p99={inprog['saveAll']['runWide']['p99']}ms hb p99={inprog['heartbeat']['runWide']['p99']}ms "
          f"cpu/succ={api_cpu['cpuPerSuccessMs']}ms t6={t6['verdict']}")


if __name__ == "__main__":
    main()
