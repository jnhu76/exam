#!/usr/bin/env python3
"""S3-ADMIT 分析器（RESEARCH ONLY，#900/#1021）。

按 run 计算 S1 核心读数（协议 §6 S1 行）并输出降采样矩阵的单对差分、
叠加外溢、A/A 噪声地板（PROTOCOL-ADDENDUM §2.1 分析口径）与 T7 判定输入。

输入：evidence/S3-ADMIT/<run_id>/{driver.json, samples.jsonl,
      api-research-snapshots.jsonl, api-summary.json, pg-sampler-summary.json,
      oracle.json, db-oracle.json, clock-offset.txt}
输出：evidence/S3-ADMIT/<run_id>/s3-metrics.json（每 run）
      evidence/S3-ADMIT/s3-analysis.json（A vs S_sub 配对差分 + A/A）
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

S3_ROOT = os.path.dirname(os.path.abspath(__file__))


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


def submit_gate_series(run_dir):
    """api-research-snapshots.jsonl → submitAdmission 快照序列（S3 臂）。

    A 臂（冻结构建）没有 submitAdmission 字段；S4 臂每个快照带 config/
    counters/peaks/live。计数器单调递增，最后一个快照即 run 累计值。
    """
    out = []
    for s in load_jsonl(os.path.join(run_dir, "api-research-snapshots.jsonl")):
        adm = s.get("submitAdmission")
        if adm:
            out.append(adm)
    return out


def analyze_run(run_id):
    run_dir = os.path.join(S3_ROOT, run_id)
    driver = json.load(open(os.path.join(run_dir, "driver.json")))
    meta = json.load(open(os.path.join(run_dir, "s3-run-meta.json")))
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

    # ── S3 门观测（A 臂无字段；S4 臂有 config/counters/peaks/live） ───────────
    gate_series = submit_gate_series(run_dir)
    gate = None
    if gate_series:
        peaks = {"waiting": 0, "permits": 0}
        for g in gate_series:
            gp = g.get("peaks") or {}
            peaks["waiting"] = max(peaks["waiting"], gp.get("waiting") or 0)
            peaks["permits"] = max(peaks["permits"], gp.get("permits") or 0)
        last = gate_series[-1]
        gate = {
            "snapshotsWithGate": len(gate_series),
            "config": last.get("config"),
            "countersFinal": last.get("counters"),
            "peaksAcrossSnapshots": peaks,
            "liveAtEnd": last.get("live"),
            "queueFormed": peaks["waiting"] > 0,
        }

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
        "submitAdmission": gate,
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
        run_dir = os.path.join(S3_ROOT, r)
        if not os.path.exists(os.path.join(run_dir, "driver.json")):
            print(f"[s3-analyze] SKIP {r}: no driver.json")
            continue
        m = analyze_run(r)
        per_run[r] = m
        with open(os.path.join(run_dir, "s3-metrics.json"), "w") as f:
            json.dump(m, f, ensure_ascii=False, indent=1)
        print(f"[s3-analyze] {r}: arm={m['arm']} submitP99={m['submit']['p99Ms']}ms "
              f"verified={m['submit']['verified']}/{m['submit']['offered']} "
              f"drain={m['submit']['drainMs']}ms "
              f"saveT7p99={((m.get('bg') or {}).get('saveT7') or {}).get('p99Ms')}ms "
              f"hbT7p99={((m.get('bg') or {}).get('hbT7') or {}).get('p99Ms')}ms "
              f"borrowEst={m['borrowWaitEstimate']['borrowP99EstMs']}ms t6={m['t6']['verdict']}")

    def get_path(d, path):
        cur = d
        for k in path.split("."):
            if cur is None:
                return None
            cur = cur.get(k) if isinstance(cur, dict) else None
        return cur

    METRICS = [
        "submit.p99Ms", "submit.p50Ms", "submit.maxMs", "submit.drainMs",
        "submit.lastConfirmMinusT0Ms", "submit.verified",
        "pgTx.t7Window.p99Ms", "pool.t7Window.sqlArrivalsInWindow",
        "borrowWaitEstimate.borrowP99EstMs",
        "bg.saveT7.p99Ms", "bg.saveT7.maxMs",
        "bg.hbT7.p99Ms", "bg.hbT7.maxMs",
        "bg.proctorT7.p99Ms",
    ]

    analysis = {
        "experiment": "S3-ADMIT",
        "armDefinitions": {
            "a": "frozen-SHA build apps/api/dist (no submit admission env)",
            "s4": "S3 branch build apps/api/dist-s3 + SUBMIT_ADMISSION=1 "
                  "(S_sub=4, Q_sub=200, W_sub=15000ms)",
        },
        "runs": per_run,
        "pairs": {},
        "aaNoiseFloor": None,
        "summary": {},
        "gateObservation": {},
        "notes": [
            "配对按 run 分析（PROTOCOL §9.5）：每对先算 (S4−A)/A 相对效应，再跨对取中位数 [min,max] 与方向一致性（3/3 同向）。",
            "p99 同报 max 与 N（PROTOCOL §6 小样本纪律）；每 run 原始分布保留在 driver.json/samples.jsonl。",
            "A/A 噪声地板 = |aa2−aa1|/aa1（同臂同配置连续两轮）；任何单对差分落入噪声区判 INCONCLUSIVE（ADDENDUM §2.1/§4.2）。",
        ],
    }

    # ── 配对：run id 后缀 r<k><a|b> 标识配对与臂序（a=A，b=S4） ──────────────
    import re
    import statistics
    pair_map = {}
    for r, m in per_run.items():
        mr = re.search(r"-(r\d+)([ab])$", r)
        if not mr:
            continue
        pair_map.setdefault(mr.group(1), {})[mr.group(2)] = m

    def rel(a, b, path):
        va, vb = get_path(a, path), get_path(b, path)
        if va in (None, 0) or vb is None:
            return None
        return round((vb - va) / va * 100, 1)

    for key in sorted(pair_map, key=lambda k: int(k[1:])):
        arms = pair_map[key]
        a, s4 = arms.get("a"), arms.get("b")
        if not a or not s4:
            analysis["pairs"][key] = {"complete": False,
                                      "present": sorted(arms.keys())}
            continue
        entry = {
            "complete": True,
            "aRun": a["runId"], "s4Run": s4["runId"],
            "order": f"{a['runId']} -> {s4['runId']}",
            "relDiffPct": {k: rel(a, s4, k) for k in METRICS},
            "raw": {k: [get_path(a, k), get_path(s4, k)] for k in METRICS},
            "completion": {
                "a": {"verified": a["submit"]["verified"], "offered": a["submit"]["offered"],
                      "terminalOk": (a.get("oracle") or {}).get("terminalOk"),
                      "statusTally": a["submit"]["statusTally"]},
                "s4": {"verified": s4["submit"]["verified"], "offered": s4["submit"]["offered"],
                       "terminalOk": (s4.get("oracle") or {}).get("terminalOk"),
                       "statusTally": s4["submit"]["statusTally"]},
            },
            "lastConfirmMinusT0Ms": {
                "a": a["submit"]["lastConfirmMinusT0Ms"],
                "s4": s4["submit"]["lastConfirmMinusT0Ms"],
            },
            "gate": s4.get("submitAdmission"),
        }
        analysis["pairs"][key] = entry

    complete = [p for p in analysis["pairs"].values() if p.get("complete")]
    if complete:
        summary = {}
        for k in METRICS:
            vals = [p["relDiffPct"][k] for p in complete if p["relDiffPct"][k] is not None]
            if not vals:
                summary[k] = None
                continue
            same_dir = sum(1 for v in vals if v > 0) if all(v >= 0 for v in vals) else \
                       sum(1 for v in vals if v < 0) if all(v <= 0 for v in vals) else 0
            summary[k] = {
                "nPairs": len(vals),
                "medianPct": round(statistics.median(vals), 1),
                "minPct": min(vals), "maxPct": max(vals),
                "values": vals,
                "sameDirection": same_dir,
            }
        analysis["summary"] = summary

    # ── A/A 噪声地板（同臂连续两轮 aa1→aa2） ─────────────────────────────────
    aa1 = per_run.get("S3-ADMIT-A-P3-S200-overlay-aa1")
    aa2 = per_run.get("S3-ADMIT-A-P3-S200-overlay-aa2")
    if aa1 and aa2:
        analysis["aaNoiseFloor"] = {
            "a": aa1["runId"], "b": aa2["runId"],
            "relDiffPct": {k: rel(aa1, aa2, k) for k in METRICS},
            "absRelDiffPct": {k: (round(abs(v), 1) if v is not None else None)
                              for k, v in ((k, rel(aa1, aa2, k)) for k in METRICS)},
        }

    # ── 门观测：S4 臂计数器/峰值/复位 + A 臂无字段 ──────────────────────────
    for r, m in per_run.items():
        analysis["gateObservation"][r] = {
            "arm": m["arm"],
            "submitAdmission": m.get("submitAdmission"),
        }

    out_path = os.path.join(S3_ROOT, "s3-analysis.json")
    with open(out_path, "w") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=1)
    print(f"[s3-analyze] written: {out_path}")
    print(json.dumps({"summary": analysis["summary"],
                      "aaNoiseFloor": analysis["aaNoiseFloor"]},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
