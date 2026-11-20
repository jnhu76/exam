#!/usr/bin/env python3
"""L1-VERIFY 聚合分析（RESEARCH ONLY）：从各 run 原始 artifacts 重算指标。

只读原始数据（samples.jsonl / metrics.jsonl / api-sampler.jsonl /
api-summary.json / driver.json / oracle.json / run-summary.json），产出：
  - 每组每并发点每 run 的关键指标行（吞吐、CPU/成功、时长分位、原生并发代理、RSS、EL）
  - 每点 5-run 中位数 [min,max] + A/A 相对极差（前 2 轮，T4 口径）
  - 拐点判读输入（吞吐与 CPU/op 随 C 的曲线）

用法：python3 l1-analyze.py [--root=<evidence/L1-VERIFY>] [--out=<analysis.json>]
"""
import json
import sys
import os
import glob
import statistics as st

ROOT = None
OUT = None
for a in sys.argv[1:]:
    if a.startswith("--root="):
        ROOT = a.split("=", 1)[1]
    elif a.startswith("--out="):
        OUT = a.split("=", 1)[1]
ROOT = ROOT or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "evidence", "L1-VERIFY")


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(p / 100 * len(sorted_vals)))]


def load_json(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None


def load_jsonl(p):
    try:
        with open(p) as f:
            return [json.loads(l) for l in f if l.strip()]
    except Exception:
        return []


def analyze_isolated(run_dir):
    """隔离组：直接采用 run-summary.json（由 runner 从 samples/metrics 现算），
    此处仅重采样核对吞吐与分位（从 samples.jsonl 重算）。"""
    s = load_json(os.path.join(run_dir, "run-summary.json"))
    samples = load_jsonl(os.path.join(run_dir, "samples.jsonl"))
    if not s or not samples:
        return None
    durs = sorted(x["durMs"] for x in samples)
    wall = (samples[-1]["endMs"] - samples[0]["startMs"]) if samples else None
    n = len(samples)
    ok = sum(1 for x in samples if x["ok"])
    # in-flight 重叠（含 libuv 排队）
    events = []
    for x in samples:
        events.append((x["startMs"], 1))
        events.append((x["endMs"], -1))
    events.sort(key=lambda e: (e[0], e[1]))
    cur = mx = 0
    for _, d in events:
        cur += d
        mx = max(mx, cur)
    return {
        "runId": s["runId"],
        "C": s["concurrency"],
        "N": n,
        "ok": ok,
        "wallMsRunner": s["wallMs"],
        "wallMsRespan": round(wall, 1) if wall else None,
        "throughputRunner": s["throughputPerSec"],
        "throughputRespan": round(n / (wall / 1000), 2) if wall else None,
        "durP50": pct(durs, 50), "durP95": pct(durs, 95),
        "durP99": pct(durs, 99), "durMax": durs[-1] if durs else None,
        "cpuTotalMs": s["cpu"]["procStatTotalMs"],
        "cpuPerOpMs": s["cpu"]["msPerOp"],
        "avgBusyThreads": s["cpu"]["avgBusyThreads"],
        "maxInFlight": mx,
        "vmHwmKb": s["memory"]["vmHwmKb"],
        "elMaxMsMaxOfTicks": s["eventLoop"]["maxMsMaxOfTicks"],
        "elP99MaxOfTicks": s["eventLoop"]["p99MaxOfTicks"],
    }


def active_window_cpu(ticks, idle_thr_ms=100):
    """HTTP 组：把 API CPU 限定在活跃窗口（首个 procΔ≥阈值 的 tick 到回落）。
    ticks: [{tMs, procTicks, mainTicks, busyThreads,...}]"""
    if not ticks or len(ticks) < 3:
        return None
    deltas = []
    for i in range(1, len(ticks)):
        if ticks[i]["procTicks"] is None or ticks[i - 1]["procTicks"] is None:
            deltas.append(None)
        else:
            deltas.append((ticks[i]["procTicks"] - ticks[i - 1]["procTicks"]) * 10)
    act = [i for i, d in enumerate(deltas) if d is not None and d >= idle_thr_ms]
    if not act:
        return None
    lo, hi = act[0], act[-1]
    # 起点前一 tick 为基线，终点含回落 tick（burst 尾部仍烧 CPU）
    start_tick = max(0, lo - 1 + 1)  # lo 对应 ticks[lo+1]
    start_idx = lo  # deltas[i] 是 ticks[i+1]-ticks[i] → 窗口起点 ticks[lo]
    end_idx = min(hi + 1, len(ticks) - 1)
    cpu_ms = (ticks[end_idx]["procTicks"] - ticks[start_idx]["procTicks"]) * 10
    wall_ms = ticks[end_idx]["tMs"] - ticks[start_idx]["tMs"]
    main_ms = None
    if ticks[end_idx].get("mainTicks") is not None and ticks[start_idx].get("mainTicks") is not None:
        main_ms = (ticks[end_idx]["mainTicks"] - ticks[start_idx]["mainTicks"]) * 10
    busy_max = max((t.get("busyThreads") or 0) for t in ticks[start_idx:end_idx + 1])
    busy_non_main_max = max((t.get("busyThreadsNonMain") or 0) for t in ticks[start_idx:end_idx + 1])
    return {
        "activeWallMs": wall_ms,
        "activeCpuMs": cpu_ms,
        "activeMainThreadMs": main_ms,
        "busyThreadsMax": busy_max,
        "busyThreadsNonMainMax": busy_non_main_max,
        "activeTickSpan": [ticks[start_idx]["tMs"], ticks[end_idx]["tMs"]],
    }


def env_mode(run_dir):
    """环境模式标签：run-meta.envProbe（固定负载 argon2 C=1 探针吞吐，
    快模式基线 ≈23.5-24.4/s）。threshold 21/s ≈ 87% 基线。"""
    m = load_json(os.path.join(run_dir, "run-meta.json"))
    if not m:
        return "unprobed", None, None
    p = m.get("envProbe") or {}
    pre = p.get("preThrPerSec")
    post = p.get("postThrPerSec")
    if pre is None and post is None:
        return "unprobed", None, None
    try:
        pre_v = float(pre) if pre else None
        post_v = float(post) if post else None
    except (TypeError, ValueError):
        return "unprobed-invalid", None, None
    vals = [v for v in (pre_v, post_v) if v is not None]
    if min(vals) >= 21.0:
        mode = "fast"
    elif max(vals) < 21.0:
        mode = "slow"
    else:
        mode = "mixed"
    return mode, pre_v, post_v


def analyze_http(run_dir):
    d = load_json(os.path.join(run_dir, "driver.json"))
    o = load_json(os.path.join(run_dir, "oracle.json"))
    api = load_json(os.path.join(run_dir, "api-summary.json"))
    snaps = load_jsonl(os.path.join(run_dir, "api-research-snapshots.jsonl"))
    ticks = load_jsonl(os.path.join(run_dir, "api-sampler.jsonl"))
    if not d:
        return None
    mode, pre, post = env_mode(run_dir)
    aw = active_window_cpu(ticks)
    db_success = o.get("loginSuccessCandidates") if o else None
    distinct = o.get("loginSuccessDistinctCandidates") if o else None
    # EL（快照直方图：每秒窗口 p50/p90/max）
    el_max = max((s.get("process", {}).get("eventLoop", {}).get("maxMs", 0) for s in snaps), default=None)
    el_p90s = [s.get("process", {}).get("eventLoop", {}).get("p90Ms") for s in snaps]
    el_p90s = [x for x in el_p90s if x is not None]
    # 池等待可见性：postgres.js 未暴露 pending（见 pool.note），仅记录语句到达计数
    sql_first = snaps[0].get("sql", {}).get("total") if snaps else None
    sql_last = snaps[-1].get("sql", {}).get("total") if snaps else None
    return {
        "runId": d["runId"],
        "C": d["concurrency"],
        "envMode": mode,
        "envProbePre": pre,
        "envProbePost": post,
        "N": d["n"],
        "offered": d["offered"],
        "sent": d["sent"],
        "dropped": d["driverDropped"],
        "statusTally": d["statusTally"],
        "verifiedDriver": d["verifiedLogins"],
        "dbSuccess": db_success,
        "dbDistinct": distinct,
        "wallMs": d["wallMs"],
        "throughputDriverVerified": d["driverVerifiedThroughputPerSec"],
        "latP50": d["latencyOk"]["p50"], "latP95": d["latencyOk"]["p95"],
        "latP99": d["latencyOk"]["p99"], "latMax": d["latencyOk"]["max"],
        "driverCpuMaxPct": d["driverSelf"]["cpuMaxPctSingleCore"],
        "api": {
            "vmHwmKb": api.get("vmHwmKb") if api else None,
            "vmRssKbMax": api.get("vmRssKbMax") if api else None,
            "threadsTotalMax": api.get("threadsTotalMax") if api else None,
            "busyThreadsMaxWindow": api.get("busyThreadsMax") if api else None,
            "busyNonMainMaxWindow": api.get("busyThreadsNonMainMax") if api else None,
        },
        "activeWindow": aw,
        "el": {
            "snapshotMaxMs": el_max,
            "snapshotP90MedianMs": round(st.median(el_p90s), 2) if el_p90s else None,
            "snapshotCount": len(snaps),
        },
        "pool": {
            "note": "postgres.js 3.4.9 未暴露 reserved/available/pending（observedFields=[]）→ 池等待 NOT_DIRECTLY_OBSERVABLE（进程内）；L1 未跑 pg_stat_activity 采样器。间接证据：argon2 在两次查询之间不占连接、RTT 增长可全由原生槽位排队解释，但池等待本身未直接观测。",
            "sqlTotalFirst": sql_first,
            "sqlTotalLast": sql_last,
        },
    }


def series_stats(rows, key):
    vals = [r[key] for r in rows if r.get(key) is not None]
    if not vals:
        return None
    return {
        "median": round(st.median(vals), 3),
        "min": round(min(vals), 3),
        "max": round(max(vals), 3),
        "n": len(vals),
    }


def aa_range(rows, key):
    """前 2 轮相对极差（T4 口径输入）：(max-min)/median。"""
    vals = [r[key] for r in rows[:2] if r.get(key) is not None]
    if len(vals) < 2:
        return None
    med = st.median(vals)
    if med == 0:
        return None
    return round((max(vals) - min(vals)) / abs(med), 4)


def main():
    result = {"isolated": {}, "http": {}}
    for run_dir in sorted(glob.glob(os.path.join(ROOT, "L1-VERIFY-iso-*"))):
        row = analyze_isolated(run_dir)
        if row:
            result["isolated"].setdefault(row["C"], []).append(row)
    for run_dir in sorted(glob.glob(os.path.join(ROOT, "L1-VERIFY-http-*"))):
        row = analyze_http(run_dir)
        if row:
            result["http"].setdefault(row["C"], []).append(row)

    summary = {"isolated": {}, "http": {}}
    for group in ("isolated", "http"):
        for c, rows in sorted(result[group].items()):
            keys = (
                ["throughputRunner", "cpuPerOpMs", "durP50", "durP95", "durP99", "durMax",
                 "avgBusyThreads", "vmHwmKb", "elMaxMsMaxOfTicks"]
                if group == "isolated"
                else ["throughputDriverVerified", "latP50", "latP95", "latP99", "latMax"]
            )
            if group == "http":
                flat = [
                    {**r, "apiVmHwmKb": r["api"]["vmHwmKb"], "apiBusyNonMainMax": r["api"]["busyNonMainMaxWindow"]}
                    for r in rows
                ]
            stats = {k: series_stats(rows, k) for k in keys}
            aas = {}
            for k in keys:
                a = aa_range(rows, k)
                if a is not None:
                    aas[k] = a
            if group == "http":
                # 环境模式分组（探针标记；unprobed = 首轮 r1-r5）
                by_mode = {}
                for r in rows:
                    by_mode.setdefault(r.get("envMode", "unprobed"), []).append(r)
                stats["envModeCounts"] = {m: len(v) for m, v in by_mode.items()}
                for m, mrows in sorted(by_mode.items()):
                    if m in ("unprobed", "fast", "slow", "mixed"):
                        mt = [r["throughputDriverVerified"] for r in mrows]
                        stats[f"thr_mode_{m}"] = (
                            {"median": round(st.median(mt), 2), "min": round(min(mt), 2),
                             "max": round(max(mt), 2), "n": len(mt)} if mt else None
                        )
                cpu_rows = [r for r in rows if r.get("activeWindow")]
                stats["activeCpuMs"] = series_stats(cpu_rows, "activeCpuMs")
                # CPU/成功（活跃窗口口径：API 进程 CPU 增量 / DB 独立成功数）
                per_op_active = [
                    r["activeWindow"]["activeCpuMs"] / r["dbSuccess"]
                    for r in cpu_rows if r.get("dbSuccess")
                ]
                stats["cpuPerSuccessActiveMs"] = (
                    {"median": round(st.median(per_op_active), 2),
                     "min": round(min(per_op_active), 2), "max": round(max(per_op_active), 2),
                     "n": len(per_op_active)} if per_op_active else None
                )
                stats["apiVmHwmKb"] = series_stats(flat, "apiVmHwmKb")
                stats["apiBusyNonMainMax"] = series_stats(flat, "apiBusyNonMainMax")
            summary[group][c] = {"runs": len(rows), "stats": stats, "aaFirst2": aas}

    out = {"perRun": result, "perPoint": summary}
    out_path = OUT or os.path.join(ROOT, "analysis.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"written {out_path}")
    for group in ("isolated", "http"):
        for c, info in sorted(summary[group].items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 0):
            thr = info["stats"].get("throughputRunner") or info["stats"].get("throughputDriverVerified")
            cpu = info["stats"].get("cpuPerOpMs") or info["stats"].get("cpuPerSuccessActiveMs")
            print(f"{group} C={c}: runs={info['runs']} thr={thr} cpu/op={cpu}")


if __name__ == "__main__":
    main()
