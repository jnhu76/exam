#!/usr/bin/env python3
"""L2-ARRIVAL 跨 run 分析（RESEARCH ONLY，协议 §8 统计口径 + §9.5 按 run 分析）。

输入：本目录各 <runId>/l2-metrics.json（含 pilot、supplement、shared，按前缀分组）。
输出：stdout 人读表 + l2-analysis.json（机器可读）。

统计口径（§8）：
  - 配对相对效应 Δ_i=(B_i−A_i)/A_i（A=P1，B=P2），报告 中位数 [min, max] 与
    方向一致性（≥4/5 对同向）；
  - A/A：同臂 r1..r5 的相对极差（max−min)/median；相邻同臂对（执行序 run2→3、
    run4→5）另列；
  - p99 一律同报 max 与 N；不单独依赖 p 值。
"""
import glob
import json
import os
import statistics as st
from pathlib import Path

HERE = Path(__file__).parent


def med_min_max(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"median": st.median(vals), "min": min(vals), "max": max(vals), "n": len(vals)}


def rel_range(vals):
    vals = [v for v in vals if v is not None]
    if len(vals) < 2:
        return None
    m = st.median(vals)
    return (max(vals) - min(vals)) / m if m else None


def load_runs():
    runs = {}
    for f in sorted(glob.glob(str(HERE / "*" / "l2-metrics.json"))):
        rid = Path(f).parent.name
        try:
            runs[rid] = json.loads(Path(f).read_text())
        except json.JSONDecodeError:
            pass
    return runs


def get(m, path):
    cur = m
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


KEY_METRICS = {
    "loginP99Ms": "login.latencyOk.p99",
    "loginP95Ms": "login.latencyOk.p95",
    "loginMaxMs": "login.latencyOk.max",
    "indepSuccess": "login.independentSuccessDbOracle",
    "saveP99Ms": "inProgressOps.saveAll.runWide.p99",
    "saveMaxMs": "inProgressOps.saveAll.runWide.max",
    "hbP99Ms": "inProgressOps.heartbeat.runWide.p99",
    "hbMaxMs": "inProgressOps.heartbeat.runWide.max",
    "startP99Ms": "inProgressOps.start.runWide.p99",
    "lastLoginOkMs": "completion.lastLoginOkAfterWindowStartMs",
    "lastSubmitOkMs": "completion.lastSubmitOkAfterWindowStartMs",
    "cpuPerSuccessMs": "apiCpu.cpuPerSuccessMs",
    "elMaxMs": "eventLoop.maxMs",
    "emitLagP99Ms": "t6.emitLagP99Ms",
}


def series_key(rid):
    for pref in ("L2-PILOT-", "L2-ARRIVAL-", "L2-LOGINONLY-", "L2-SHARED-"):
        if rid.startswith(pref):
            return rid[len(pref):]
    return rid


def main():
    runs = load_runs()
    groups = {"pilot": [], "pairs": {}, "p3": {}, "loginonly": {}, "shared": []}
    for rid, m in sorted(runs.items()):
        key = series_key(rid)
        parts = key.split("-")  # e.g. P1-S20-r3 / P2-S100-r2 / P3-S200-r1
        if rid.startswith("L2-PILOT-"):
            groups["pilot"].append((rid, m))
        elif rid.startswith("L2-SHARED-"):
            groups["shared"].append((rid, m))
        elif rid.startswith("L2-LOGINONLY-"):
            prof, size = parts[0], parts[1]
            groups["loginonly"].setdefault(f"{prof}-{size}", []).append((rid, m))
        elif len(parts) == 3:
            prof, size, rep = parts
            bucket = groups["pairs"] if prof in ("P1", "P2") else groups["p3"]
            bucket.setdefault(f"{prof}-{size}", []).append((rid, m, rep))

    out = {"runs": {}, "pairs": {}, "aa": {}, "p3": {}, "loginonly": {}, "shared": {}}

    # ── 每 run 一行（全组） ──────────────────────────────────────────────
    for rid, m in sorted(runs.items()):
        row = {"profile": m.get("profile"), "n": m.get("n"), "t6": get(m, "t6.verdict"),
               "failed": bool((HERE / rid / "FAILED.md").exists())}
        for name, path in KEY_METRICS.items():
            row[name] = get(m, path)
        row["loginOkRatio"] = (
            get(m, "login.ok") / get(m, "login.offered") if get(m, "login.offered") else None
        )
        rej = get(m, "rejections") or {}
        row["rej429"] = rej.get("http429")
        row["rej401"] = rej.get("http401")
        row["rejNetTimeout"] = rej.get("networkTimeout")
        row["dropped"] = rej.get("driverDropped")
        out["runs"][rid] = row

    # ── P1 vs P2 配对（按同 r 配对：Δ=(P2−P1)/P1） ────────────────────────
    for size in ("S20", "S50", "S100", "S200"):
        a = {rep: m for rid, m, rep in groups["pairs"].get(f"P1-{size}", [])}
        b = {rep: m for rid, m, rep in groups["pairs"].get(f"P2-{size}", [])}
        common = sorted(set(a) & set(b))
        if not common:
            continue
        size_pair = {"pairs": len(common), "metrics": {}}
        for name, path in KEY_METRICS.items():
            deltas, rawA, rawB = [], [], []
            for rep in common:
                va, vb = get(a[rep], path), get(b[rep], path)
                if va is not None and vb is not None:
                    rawA.append(va)
                    rawB.append(vb)
                    if va != 0:
                        deltas.append((vb - va) / va)
            if deltas:
                same_dir = sum(1 for d in deltas if (d > 0) == (deltas[0] > 0 or d == 0 and True))
                size_pair["metrics"][name] = {
                    "deltaRel": med_min_max(deltas),
                    "directionConsistent": f"{same_dir}/{len(deltas)}",
                    "P1": med_min_max(rawA),
                    "P2": med_min_max(rawB),
                }
        out["pairs"][size] = size_pair

    # ── A/A（同臂 r1..r5 相对极差 + 相邻同臂对） ─────────────────────────
    for arm_size, lst in {**groups["pairs"], **groups["p3"]}.items():
        vals = {}
        for rid, m, rep in sorted(lst, key=lambda x: int(x[2][1:])):
            for name, path in KEY_METRICS.items():
                vals.setdefault(name, []).append(get(m, path))
        out["aa"][arm_size] = {
            name: {"relRange": rel_range(v), **med_min_max(v)} for name, v in vals.items()
        }

    # ── 相邻同臂 A/A（执行序 P2r1→P2r2 与 P1r2→P1r3 等） ────────────────
    adj = {}
    for size in ("S20", "S50", "S100", "S200"):
        for arm in ("P1", "P2"):
            lst = sorted(groups["pairs"].get(f"{arm}-{size}", []), key=lambda x: int(x[2][1:]))
            for (rid1, m1, r1), (rid2, m2, r2) in zip(lst, lst[1:]):
                d = {}
                for name, path in KEY_METRICS.items():
                    v1, v2 = get(m1, path), get(m2, path)
                    if v1 is not None and v2 is not None and v1 != 0:
                        d[name] = round((v2 - v1) / v1, 4)
                adj[f"{arm}{size}:{r1}→{r2}"] = d
    out["aa"]["adjacentSameArmRelDelta"] = adj

    # ── P3 特性表 ────────────────────────────────────────────────────────
    for arm_size, lst in groups["p3"].items():
        agg = {}
        for name, path in KEY_METRICS.items():
            agg[name] = med_min_max([get(m, path) for _, m, _ in lst])
        agg["emitWidthMs"] = med_min_max([get(m, "arrival.sameMomentActualEmitWidthMs") for _, m, _ in lst])
        out["p3"][arm_size] = agg

    # ── 纯登录补测（CPU 分解） ───────────────────────────────────────────
    for arm_size, lst in groups["loginonly"].items():
        agg = {}
        for name, path in KEY_METRICS.items():
            agg[name] = med_min_max([get(m, path) for _, m in lst])
        out["loginonly"][arm_size] = agg

    # ── shared 单列 ──────────────────────────────────────────────────────
    for rid, m in groups["shared"]:
        row = {name: get(m, path) for name, path in KEY_METRICS.items()}
        row["rej429"] = (get(m, "rejections") or {}).get("http429")
        row["loginOk"] = get(m, "login.ok")
        out["shared"][rid] = row

    (HERE / "l2-analysis.json").write_text(json.dumps(out, indent=2) + "\n")

    # ── 人读输出 ────────────────────────────────────────────────────────
    print("== per-run ==")
    hdr = ["runId", "prof", "n", "ok", "ratio", "p99", "max", "saveP99", "hbP99",
           "lastLogin", "cpu/succ", "429", "t6", "fail"]
    print("\t".join(hdr))
    for rid, row in sorted(out["runs"].items()):
        print("\t".join(str(x) for x in [
            rid, row["profile"], row["n"], row.get("indepSuccess"),
            row.get("loginOkRatio"), row.get("loginP99Ms"), row.get("loginMaxMs"),
            row.get("saveP99Ms"), row.get("hbP99Ms"), row.get("lastLoginOkMs"),
            row.get("cpuPerSuccessMs"), row.get("rej429"), row["t6"], row["failed"],
        ]))
    print("\n== P1 vs P2 pairing (Δ=(P2−P1)/P1, median[min,max]) ==")
    for size, sp in out["pairs"].items():
        print(f"-- {size} ({sp['pairs']} pairs)")
        for name, mm in sp["metrics"].items():
            d = mm["deltaRel"]
            print(f"   {name:16s} Δmed={d['median']:+.3f} [{d['min']:+.3f},{d['max']:+.3f}] "
                  f"dir={mm['directionConsistent']}  P1med={mm['P1']['median']} P2med={mm['P2']['median']}")
    print("\n== A/A rel-range (same arm r1..r5) ==")
    for arm_size, mm in out["aa"].items():
        if arm_size == "adjacentSameArmRelDelta":
            continue
        keys = ("loginP99Ms", "indepSuccess", "saveP99Ms", "hbP99Ms", "cpuPerSuccessMs")
        print(f"   {arm_size:8s} " + "  ".join(
            f"{k}={mm[k]['relRange']:.3f}" if mm[k]["relRange"] is not None else f"{k}=n/a" for k in keys))
    print("\n== P3 ==")
    for arm_size, agg in out["p3"].items():
        print(f"   {arm_size}: loginP99={agg['loginP99Ms'] and agg['loginP99Ms']['median']}ms "
              f"emitWidth={agg['emitWidthMs'] and agg['emitWidthMs']['median']}ms "
              f"lagP99={agg['emitLagP99Ms'] and agg['emitLagP99Ms']['median']}ms "
              f"saveP99={agg['saveP99Ms'] and agg['saveP99Ms']['median']}ms "
              f"indep={agg['indepSuccess'] and agg['indepSuccess']['median']}")
    print("\n== loginonly ==")
    for arm_size, agg in out["loginonly"].items():
        print(f"   {arm_size}: cpu/succ={agg['cpuPerSuccessMs'] and agg['cpuPerSuccessMs']['median']}ms "
              f"loginP99={agg['loginP99Ms'] and agg['loginP99Ms']['median']}ms "
              f"indep={agg['indepSuccess'] and agg['indepSuccess']['median']}")
    print("\n== shared ==")
    for rid, row in out["shared"].items():
        print(f"   {rid}: ok={row['loginOk']} 429={row['rej429']} p99={row['loginP99Ms']}ms")
    print(f"\nwritten: {HERE / 'l2-analysis.json'}")


if __name__ == "__main__":
    main()
