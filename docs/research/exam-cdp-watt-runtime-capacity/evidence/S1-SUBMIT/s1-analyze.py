#!/usr/bin/env python3
"""S1-SUBMIT 分析器（RESEARCH ONLY，#900/#1021）。

按 run 计算 S1 核心读数（协议 §6 S1 行）并输出降采样矩阵的单对差分、
叠加外溢、A/A 噪声地板（PROTOCOL-ADDENDUM §2.1 分析口径）与 T7 判定输入。

输入：evidence/S1-SUBMIT/<run_id>/{driver.json, samples.jsonl,
      api-research-snapshots.jsonl, api-summary.json, pg-sampler-summary.json,
      oracle.json, db-oracle.json, clock-offset.txt}
输出：evidence/S1-SUBMIT/<run_id>/s1-metrics.json（每 run）
      evidence/S1-SUBMIT/s1-analysis.json（跨 run 差分 + T7）
      stdout 人类可读摘要。

口径备注（与协议一致）：
  - T7 窗口 = 首提交请求 → 最后权威确认 +10s；
  - 借连接等待 p99（T7a）无法进程内直接观测（measurement-neutrality law），
    用分解估计：submit HTTP p99 − 非借连接成分保守上界（PG 事务 p99（执行侧
    采样）+ 无事务请求 RT p99（监考读，auth+读路径同构）），并要求
    pool.pending 持续 >0 的直接证据（reserved=10）；
  - 保存/心跳尾延迟（T7b）= 同 run 内 [T0-60s,T0) 基线 vs T7 窗口，
    判据 ≥2× 且绝对值 ≥50ms；
  - 小样本 p99 同报 max 与 N（§6 小样本纪律）。
"""
import json
import os
import sys

S1_ROOT = os.path.dirname(os.path.abspath(__file__))


def pct(arr, p):
    if not arr:
        return None
    s = sorted(arr)
    return s[min(len(s) - 1, int(len(s) * p / 100))]


def load_jsonl(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def clock_offset_ms(run_dir):
    """container_ms - host_ms（driver epoch → host epoch 校正）。"""
    path = os.path.join(run_dir, "clock-offset.txt")
    if not os.path.exists(path):
        return 0
    vals = {}
    for line in open(path):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            try:
                vals[k] = int(v)
            except ValueError:
                pass
    if "host_ms" in vals and "container_ms" in vals:
        return vals["container_ms"] - vals["host_ms"]
    return 0


def snap_series(run_dir):
    """api-research-snapshots.jsonl → [{hostEpochMs, sqlTotal, sqlDelta, elMaxMs, ...}]。

    快照 tMs 为采样器相对时刻；采样器起始 epoch 取 api-summary.windowStartIso。
    注：postgres.js 3.4.9 的 Sql 对象不暴露 reserved/pending（capacityResearch.ts
    探测为空，L2 系列同样如此）——池等待观测按协议 §6 用语句到达计数（sqlDelta）
    + 客户端 RT 分解 + pg_stat_activity 会话占用（pgSide）三路证据。
    """
    snaps = load_jsonl(os.path.join(run_dir, "api-research-snapshots.jsonl"))
    start_epoch = None
    try:
        import datetime
        summary = json.load(open(os.path.join(run_dir, "api-summary.json")))
        iso = summary.get("windowStartIso")
        if iso:
            start_epoch = datetime.datetime.fromisoformat(
                iso.replace("Z", "+00:00")
            ).timestamp() * 1000
    except Exception:
        start_epoch = None
    out = []
    if start_epoch is None:
        return out
    for s in snaps:
        sql = s.get("sql") or {}
        proc = s.get("process") or {}
        el = (proc.get("eventLoop") or {})
        out.append({
            "hostEpochMs": start_epoch + float(s.get("tMs", 0)),
            "sqlTotal": sql.get("total"),
            "sqlDelta": s.get("sqlDelta"),
            "elMaxMs": el.get("maxMs"),
            "rssBytes": proc.get("rssBytes"),
        })
    return out


def snap_window_stats(series, t0, t1):
    """[t0,t1) 窗口内语句到达（sqlDelta）与 EL max 概况。"""
    in_win = [p for p in series if t0 is not None and t1 is not None and t0 <= p["hostEpochMs"] < t1]
    deltas = [p["sqlDelta"] for p in in_win if p.get("sqlDelta") is not None]
    return {
        "samples": len(in_win),
        "sqlArrivalsInWindow": sum(deltas),
        "sqlDeltaMaxPer250ms": max(deltas) if deltas else None,
        "eventLoopMaxMs": max((p["elMaxMs"] for p in in_win if p.get("elMaxMs") is not None), default=None),
    }


def analyze_run(run_id):
    run_dir = os.path.join(S1_ROOT, run_id)
    driver = json.load(open(os.path.join(run_dir, "driver.json")))
    meta = json.load(open(os.path.join(run_dir, "s1-run-meta.json")))
    samples = load_jsonl(os.path.join(run_dir, "samples.jsonl"))
    off = clock_offset_ms(run_dir)  # container - host

    def to_host(epoch):
        return None if epoch is None else epoch - off

    t0 = to_host(driver["timeline"]["t0Epoch"])
    sub = driver["submit"]
    first_sent = to_host(sub.get("firstSentEpoch"))
    last_confirm = to_host(sub.get("lastConfirmEpoch"))
    t7_end = (last_confirm + 10_000) if last_confirm else None
    t7_start = first_sent  # 首提交请求

    # ── submit 分布（driver.json 已含 p50..max 与 sorted 数组） ──────────────
    submit_block = {
        "offered": driver["offered"],
        "verified": driver["verified"],
        "dropped": driver["dropped"],
        "statusTally": driver["statusTally"],
        "p50Ms": sub["p50Ms"], "p95Ms": sub["p95Ms"], "p99Ms": sub["p99Ms"],
        "maxMs": sub["maxMs"], "n": sub["n"],
        "drainMs": (sub["lastResponseEpoch"] - sub["firstSentEpoch"]) if sub.get("lastResponseEpoch") and sub.get("firstSentEpoch") else None,
        "lastConfirmMinusT0Ms": (sub["lastConfirmEpoch"] - driver["timeline"]["t0Epoch"]) if sub.get("lastConfirmEpoch") else None,
        "errors": sub["errors"],
    }

    # ── bg/proctor 窗口分布（samples.jsonl 按 epoch 切窗） ──────────────────
    def win_dist(kind, verified_only, lo, hi):
        lat = [s["latencyMs"] for s in samples
               if s.get("kind") == kind and s.get("latencyMs") is not None
               and (s.get("verified") is True or not verified_only)
               and lo is not None and hi is not None
               and s.get("responseEpoch") is not None
               and lo <= (s["responseEpoch"] - off) < hi]
        rejected = sum(1 for s in samples
                       if s.get("kind") == kind and s.get("phase") == "steady"
                       and s.get("verified") is not True
                       and lo is not None and hi is not None
                       and s.get("responseEpoch") is not None
                       and lo <= (s["responseEpoch"] - off) < hi)
        return {
            "n": len(lat), "p50Ms": pct(lat, 50), "p95Ms": pct(lat, 95),
            "p99Ms": pct(lat, 99),
            "maxMs": max(lat) if lat else None,
            "sortedMs": sorted(lat) if 0 < len(lat) <= 400 else None,
            "rejectedOrFailed": rejected,
        }

    pre_lo, pre_hi = (t0 - 60_000) if t0 else None, t0
    bg = None
    if meta["mode"] == "overlay" and t0 and t7_end:
        bg = {
            "window": {"pre": [pre_lo, t0], "t7": [t7_start, t7_end]},
            "savePre": win_dist("save", True, pre_lo, t0),
            "saveT7": win_dist("save", True, t7_start, t7_end),
            "hbPre": win_dist("heartbeat", True, pre_lo, t0),
            "hbT7": win_dist("heartbeat", True, t7_start, t7_end),
            "proctorPre": win_dist("proctor-read", True, pre_lo, t0),
            "proctorT7": win_dist("proctor-read", True, t7_start, t7_end),
        }

    # ── PG 执行侧：T7 窗口内的事务时长 / lock wait / 会话占用（pg-activity） ──
    pg = {}
    pg_path = os.path.join(run_dir, "pg-sampler-summary.json")
    if os.path.exists(pg_path):
        pg = json.load(open(pg_path))
    pg_start = pg.get("startedAtEpochMs")
    tx_t7 = None
    lock_t7 = None
    pgside_t7 = None
    if pg_start is not None and t7_start and t7_end:
        acts = load_jsonl(os.path.join(run_dir, "pg-activity.jsonl"))
        ages = {}
        locks = {}
        busy_per_poll = []  # 每次采样中 API 池会话 busy（active 或 idle-in-tx）数
        for a in acts:
            epoch = pg_start + float(a.get("tMs", 0))
            if not (t7_start <= epoch < t7_end):
                continue
            busy = 0
            for r in a.get("rows", []):
                pid = r.get("pid")
                age = r.get("xact_age_ms")
                if age is not None:
                    ages[pid] = max(ages.get(pid, 0), age)
                if r.get("state") == "active" or (r.get("xact_start") is not None):
                    busy += 1
                if r.get("wait_event_type") == "Lock":
                    e = locks.setdefault(pid, {
                        "pid": pid, "waitEvent": f"{r.get('wait_event_type')}:{r.get('wait_event')}",
                        "blockers": r.get("blockers"), "q": (r.get("q") or "")[:120],
                        "maxAgeMs": 0,
                    })
                    e["maxAgeMs"] = max(e["maxAgeMs"], age or 0)
            busy_per_poll.append(busy)
        tx_ages = sorted(ages.values())
        tx_t7 = {
            "note": "T7 窗口内 per-pid 最大 xact 年龄（250ms 采样下界，短事务可能整段错过）",
            "distinctPids": len(tx_ages),
            "p50Ms": pct(tx_ages, 50), "p95Ms": pct(tx_ages, 95),
            "p99Ms": pct(tx_ages, 99),
            "maxMs": tx_ages[-1] if tx_ages else None,
        }
        lock_t7 = {"distinctPids": len(locks), "events": list(locks.values())[:20]}
        pgside_t7 = {
            "note": "API postgres.js 池 max=10；busy=pg_stat_activity 中 active 或 idle-in-transaction 会话数（执行侧占用，客户端排队不可见于 PG）",
            "polls": len(busy_per_poll),
            "maxBusySessions": max(busy_per_poll) if busy_per_poll else None,
            "pollsAtMax10": sum(1 for b in busy_per_poll if b >= 10),
            "pollsAtLeast8": sum(1 for b in busy_per_poll if b >= 8),
            "busySeries": busy_per_poll,
        }

    # ── 进程内研究快照（250ms）：语句到达计数 + EL ─────────────────────────────
    series = snap_series(run_dir)
    snap_t7 = snap_window_stats(series, (t7_start - 500) if t7_start else None, t7_end) if t7_start else None
    snap_pre = snap_window_stats(series, pre_lo, t0) if t0 else None
    # 事务借连接等待估计（T7a）：submit p99 − 非借连接成分保守上界
    tx_p99 = (tx_t7 or {}).get("p99Ms") or (pg.get("txDuration") or {}).get("p99Ms")
    proctor_p99_pre = (bg or {}).get("proctorPre", {}).get("p99Ms")
    non_borrow_upper = None
    borrow_p99_est = None
    if submit_block["p99Ms"] is not None and tx_p99 is not None and proctor_p99_pre is not None:
        non_borrow_upper = tx_p99 + proctor_p99_pre
        borrow_p99_est = submit_block["p99Ms"] - non_borrow_upper
    # 保守上界兜底：无监考读（pure）时用 PG 事务 p99 + 50ms（nginx+两次事务外读的量级上界）
    elif submit_block["p99Ms"] is not None and tx_p99 is not None:
        non_borrow_upper = tx_p99 + 50
        borrow_p99_est = submit_block["p99Ms"] - non_borrow_upper

    # ── T7 窗口 API/宿主 CPU（采样器 /proc tick；§5.3 分子=窗口增量，分母=oracle 成功数） ──
    cpu_t7 = None
    try:
        import datetime
        summary = json.load(open(os.path.join(run_dir, "api-summary.json")))
        start_epoch = datetime.datetime.fromisoformat(
            summary["windowStartIso"].replace("Z", "+00:00")).timestamp() * 1000
        ticks = load_jsonl(os.path.join(run_dir, "api-sampler.jsonl"))
        in_win = [t for t in ticks if t7_start is not None and t7_end is not None
                  and t7_start <= start_epoch + float(t.get("tMs", 0)) < t7_end]
        if len(in_win) >= 2:
            dproc = (in_win[-1]["procTicks"] - in_win[0]["procTicks"]) * 10
            dmain = (in_win[-1]["mainTicks"] - in_win[0]["mainTicks"]) * 10
            dhost = (in_win[-1]["hostTicks"] or 0) - (in_win[0]["hostTicks"] or 0)
            succ = m_oracle_terminal = None
            cpu_t7 = {
                "ticksInWindow": len(in_win),
                "apiProcCpuMs": dproc,
                "apiMainThreadCpuMs": dmain,
                "hostCpuTicksDelta": dhost,
                "cpuMsPerVerifiedSubmit": round(dproc / max(1, driver["verified"]), 1),
                "mainThreadSharePct": round(100 * dmain / max(1, dproc), 1),
            }
    except Exception:
        cpu_t7 = None

    # ── T6（driver 余量） ─────────────────────────────────────────────────────
    cpu = driver.get("driverCpu") or {}
    lag = driver.get("sendLag") or {}
    dropped = driver.get("dropped")
    t6 = "PASS"
    reasons = []
    if dropped:
        t6 = "FAIL"
        reasons.append(f"dropped={dropped}")
    if lag.get("p99Ms") is not None and lag["p99Ms"] > 50:
        t6 = "PASS-WITH-PLATFORM-LAG"
        reasons.append(f"emitLagP99={lag['p99Ms']}ms>50（P3 同刻经 vpnkit 桥 ~1op/ms 串行化；G1-BURST-CEILING 平台上限，L2 P3 系列同口径）")
    if cpu.get("cpuUsagePctMax1Core") is not None and cpu["cpuUsagePctMax1Core"] > 30:
        t6 = "FAIL"
        reasons.append(f"cpuMax1core={cpu['cpuUsagePctMax1Core']}%>30")

    # ── oracle 摘要 ───────────────────────────────────────────────────────────
    oracle = {}
    opath = os.path.join(run_dir, "oracle.json")
    if os.path.exists(opath):
        o = json.load(open(opath))
        oracle = {
            "terminalOk": o["submitters"]["terminalOk"],
            "mismatchCount": o["submitters"]["mismatchCount"],
            "byStatus": o["submitters"]["byStatus"],
            "receipts": o["submitters"]["confirmedReceipts"],
            "dupActive": o["invariants"]["duplicateActiveAttempts"],
            "dupTerminal": o["invariants"]["duplicateTerminalTransitions"],
            "perExamTerminal": {k[:8]: v["terminal"] for k, v in o["submitters"]["perExam"].items()},
            "bgInProgress": (o.get("background") or {}).get("stillInProgress"),
        }

    return {
        "runId": run_id,
        "arm": meta["arm"],
        "mode": meta["mode"],
        "t6": {"verdict": t6, "reasons": reasons},
        "submit": submit_block,
        "emitLag": {"p99Ms": lag.get("p99Ms"), "maxMs": lag.get("maxMs"),
                    "widthMs": lag.get("emitWidthMs"), "over50": lag.get("over50ms")},
        "pool": {"note": "postgres.js 3.4.9 不暴露 reserved/pending（capacityResearch 探测为空，L2 系列同）——池证据=sqlDelta 到达计数 + RT 分解 + pgSide 会话占用",
                 "t7Window": snap_t7, "preWindow": snap_pre,
                 "snapshotCount": len(series)},
        "pgSide": pgside_t7,
        "pgTx": {"t7Window": tx_t7, "wholeRun": pg.get("txDuration")},
        "lockWaits": {"t7Window": lock_t7,
                      "wholeRun": {"distinctPids": (pg.get("lockWaits") or {}).get("distinctPids"),
                                   "events": ((pg.get("lockWaits") or {}).get("events") or [])[:20]}},
        "borrowWaitEstimate": {
            "submitP99Ms": submit_block["p99Ms"],
            "pgTxP99Ms": tx_p99,
            "nonBorrowUpperMs": non_borrow_upper,
            "borrowP99EstMs": borrow_p99_est,
            "derivation": "submitHTTP_p99 − (pgTx_p99[T7窗] + 无事务请求RT_p99[监考读] 或 +50ms[纯臂兜底])；measurement-neutrality law 禁止进程内逐请求观测，此为保守分解（池等待为唯一剩余大头）",
        },
        "bg": bg,
        "cpuT7Window": cpu_t7,
        "driverCpu": cpu,
        "oracle": oracle,
        "clockOffsetContainerMinusHostMs": off,
        "t7Window": {"startHostEpoch": t7_start, "endHostEpoch": t7_end},
    }


def diff(a, b, key_path):
    """相对差 (b-a)/a（百分比），None 不可算。"""
    def get(d, path):
        cur = d
        for k in path.split("."):
            if cur is None:
                return None
            cur = cur.get(k) if isinstance(cur, dict) else None
        return cur
    va, vb = get(a, key_path), get(b, key_path)
    if va in (None, 0) or vb is None:
        return None
    return round((vb - va) / va * 100, 1)


def main():
    runs = sys.argv[1:]
    per_run = {}
    for r in runs:
        run_dir = os.path.join(S1_ROOT, r)
        if not os.path.exists(os.path.join(run_dir, "driver.json")):
            print(f"[s1-analyze] SKIP {r}: no driver.json")
            continue
        m = analyze_run(r)
        per_run[r] = m
        with open(os.path.join(run_dir, "s1-metrics.json"), "w") as f:
            json.dump(m, f, ensure_ascii=False, indent=1)
        print(f"[s1-analyze] {r}: submitP99={m['submit']['p99Ms']}ms verified={m['submit']['verified']}/{m['submit']['offered']} "
              f"drain={m['submit']['drainMs']}ms "
              f"sqlArrivalsT7={((m['pool']['t7Window'] or {}).get('sqlArrivalsInWindow'))} "
              f"pgMaxBusy={((m.get('pgSide') or {}).get('maxBusySessions'))} "
              f"borrowEst={m['borrowWaitEstimate']['borrowP99EstMs']}ms t6={m['t6']['verdict']}")

    # ── 跨 run 差分（ADDENDUM §2.1 口径） ────────────────────────────────────
    def find(prefix):
        for r in per_run:
            if r.startswith(prefix):
                return per_run[r]
        return None

    cross_pure = find("S1-SUBMIT-cross-pure")
    same_pure1 = find("S1-SUBMIT-same-pure-r1")
    same_pure2 = find("S1-SUBMIT-same-pure-r2")
    same_ov = find("S1-SUBMIT-same-overlay")
    cross_ov = find("S1-SUBMIT-cross-overlay")

    analysis = {"runs": per_run, "differentials": {}, "t7": {}, "notes": []}
    metrics = [
        "submit.p99Ms", "submit.p50Ms", "submit.maxMs", "submit.drainMs",
        "submit.lastConfirmMinusT0Ms", "pgTx.t7Window.p99Ms", "pgTx.t7Window.maxMs",
        "pool.t7Window.sqlArrivalsInWindow", "pgSide.maxBusySessions",
    ]
    bg_metrics = ["bg.saveT7.p99Ms", "bg.hbT7.p99Ms", "bg.proctorT7.p99Ms"]

    def pair(name, a, b, mlist):
        if not a or not b:
            analysis["differentials"][name] = None
            return
        analysis["differentials"][name] = {
            "a": a["runId"], "b": b["runId"],
            "relDiffPct": {k: diff(a, b, k) for k in mlist},
            "raw": {k: [get_path(a, k), get_path(b, k)] for k in mlist},
        }

    def get_path(d, path):
        cur = d
        for k in path.split("."):
            if cur is None:
                return None
            cur = cur.get(k) if isinstance(cur, dict) else None
        return cur

    pair("sameVsCross_pure(cross→same)", cross_pure, same_pure1, metrics)
    pair("sameVsCross_overlay(cross→same)", cross_ov, same_ov, metrics + bg_metrics)
    pair("overlaySpill_same(pure→overlay)", same_pure1, same_ov, metrics + bg_metrics)
    pair("overlaySpill_cross(pure→overlay)", cross_pure, cross_ov, metrics + bg_metrics)
    # A/A 噪声地板 = |③−②| 相对差
    if same_pure1 and same_pure2:
        analysis["differentials"]["aaNoiseFloor_samePure(|r2-r1|/r1)"] = {
            "a": same_pure1["runId"], "b": same_pure2["runId"],
            "relDiffPct": {k: diff(same_pure1, same_pure2, k) for k in metrics},
        }

    # ── T7 判定输入 ───────────────────────────────────────────────────────────
    # (a) 交卷事务借连接等待 p99 ≥100ms（T7 预注册操作化）：
    #     判据 = 借连接分解估计 ≥100ms，且池满载持续证据（pgSide 会话占用=10 的
    #     采样数 ≥1，或 T7 窗口 sql 到达持续而 drain 拉长）为直接池证据。
    def t7a(m):
        if not m:
            return None
        est = m["borrowWaitEstimate"]["borrowP99EstMs"]
        pgside = m.get("pgSide") or {}
        polls_at_max = pgside.get("pollsAtMax10") or 0
        return {
            "borrowP99EstMs": est,
            "pgMaxBusySessions": pgside.get("maxBusySessions"),
            "pollsAtMax10": polls_at_max,
            "satisfied": (est is not None and est >= 100 and polls_at_max > 0),
        }

    analysis["t7"]["a_poolWaitSustained"] = {
        "same-pure-r1": t7a(same_pure1),
        "same-pure-r2": t7a(same_pure2),
        "cross-pure-r1": t7a(cross_pure),
        "same-overlay-r1": t7a(same_ov),
        "cross-overlay-r1": t7a(cross_ov),
    }

    # (b) 同窗 save/heartbeat 等待/RT p99 相对无交卷对照恶化 ≥2× 且绝对值 ≥50ms
    def t7b(m):
        if not m or not m.get("bg"):
            return None
        out = {}
        for op in ("save", "hb", "proctor"):
            pre = m["bg"].get(f"{op}Pre", {}).get("p99Ms")
            t7w = m["bg"].get(f"{op}T7", {}).get("p99Ms")
            satisfied = False
            ratio = None
            if pre and pre > 0 and t7w is not None:
                ratio = round(t7w / pre, 2)
                satisfied = ratio >= 2 and t7w >= 50
            out[op] = {"preP99Ms": pre, "t7P99Ms": t7w, "ratio": ratio,
                       "absGe50ms": (t7w is not None and t7w >= 50),
                       "satisfied": satisfied}
        out["satisfied"] = bool(out.get("save", {}).get("satisfied") or out.get("hb", {}).get("satisfied"))
        return out

    analysis["t7"]["b_tailDegradation"] = {
        "same-overlay-r1": t7b(same_ov),
        "cross-overlay-r1": t7b(cross_ov),
    }

    out_path = os.path.join(S1_ROOT, "s1-analysis.json")
    with open(out_path, "w") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=1)
    print(f"[s1-analyze] written: {out_path}")
    print(json.dumps({"t7": analysis["t7"]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
