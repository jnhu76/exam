#!/usr/bin/env python3
"""L3-ADMISSION 配对分析（RESEARCH ONLY；协议 §9.5/§8 T1/T3/T5 + 附录 §2.2/§4）。

输入（本目录 run 目录）：
  A/A 噪声地板：L3-ADMISSION-A-P2-S200-aa1 / aa2（同臂连续，不入配对）
  配对：r<k>a / r<k>b（k=1..P，臂序交错，同一到达表 seed=9001021）

每 run 从 l2-metrics.json（l2-metrics.py 产出）+ samples.jsonl（503 归因）+
l3-run-meta.json + arm-check-post.json（B 准入 counters/peaks）提取指标；
按对计算 Δ_i=(B_i−A_i)/A_i，输出中位数 [min,max] 与方向一致性；A/A 相对差
作噪声地板对照。判定（研究性阈值，附录 §4：n=3 降采样下结论表述降级）：
  T1 采纳门禁：login p99 或 CPU/成功 配对中位数改善 ≥10%（且 RSS 峰增幅 <10%）
  T3 QoS：save p99 / heartbeat p99 配对中位数恶化 <10%
  T5 语义：B 出现 A 未出现的错误类 / 正确凭据负载出现 401
  实质容量拒绝（T8 口径）：503 LOGIN_BUSY（队满+等待到期）≥1% offered login
"""
import json
import sys
from pathlib import Path

L3_ROOT = Path(__file__).resolve().parent


def load_jsonl(path):
    rows = []
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def median(vals):
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return None
    return s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2


def run_metrics(run_dir: Path) -> dict | None:
    m_path = run_dir / "l2-metrics.json"
    if not m_path.exists():
        return None
    m = json.loads(m_path.read_text())
    meta = {}
    meta_path = run_dir / "l3-run-meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
    samples = load_jsonl(run_dir / "samples.jsonl")

    logins = [s for s in samples if s.get("kind") == "login"]
    login_503 = sum(1 for s in logins if s.get("status") == 503)
    login_401 = sum(1 for s in logins if s.get("status") == 401)
    login_429 = sum(1 for s in logins if s.get("status") == 429)
    login_net = sum(1 for s in logins if s.get("status") == 0 or s.get("status") is None)

    # B 臂准入终态（arm-check-post 的 snapshot 在 run 后读取：counters/peaks 已含全程）
    adm = None
    post = run_dir / "arm-check-post.json"
    if post.exists():
        p = json.loads(post.read_text())
        if p.get("snapshot"):
            adm = {
                "counters": p["snapshot"].get("counters"),
                "peaks": p["snapshot"].get("peaks"),
                "live": p["snapshot"].get("live"),
            }

    lat = m["login"]["latencyOk"]
    cpu = m["apiCpu"]
    save_p99 = m["inProgressOps"]["saveAll"]["runWide"]["p99"]
    hb_p99 = m["inProgressOps"]["heartbeat"]["runWide"]["p99"]
    start_p99 = m["inProgressOps"]["start"]["runWide"]["p99"]
    return {
        "runId": m.get("runId") or run_dir.name,
        "arm": meta.get("arm"),
        "failed": (run_dir / "FAILED.md").exists(),
        "offeredTotal": m.get("offered"),
        "fourLevel": m.get("fourLevel"),
        "t6": (m.get("t6") or {}).get("verdict"),
        "login": {
            "offered": len(logins),
            "ok": m["login"]["ok"],
            "indepDb": m["login"]["independentSuccessDbOracle"],
            "indepDriver": m["login"].get("independentSuccessDriverSessionValid"),
            "p50": lat["p50"], "p95": lat["p95"], "p99": lat["p99"], "max": lat["max"], "n": lat["n"],
            "status503": login_503, "status401": login_401, "status429": login_429, "netFail": login_net,
        },
        "capacityRejectionRate": (login_503 / len(logins)) if logins else None,
        "qos": {"saveP99": save_p99, "hbP99": hb_p99, "startP99": start_p99,
                "saveN": m["inProgressOps"]["saveAll"]["runWide"]["n"],
                "hbN": m["inProgressOps"]["heartbeat"]["runWide"]["n"]},
        "resources": {
            "procCpuMsWindow": cpu.get("procCpuMsWindow"),
            "cpuPerSuccessMs": cpu.get("cpuPerSuccessMs"),
            "vmHwmKb": cpu.get("vmHwmKb"),
            "busyThreadsMax": cpu.get("busyThreadsMax"),
            "eventLoopMaxMs": (m.get("eventLoop") or {}).get("maxMs"),
            "elP90MaxMs": (m.get("eventLoop") or {}).get("p90MaxMs"),
        },
        "completion": m.get("completion"),
        "rejections": m.get("rejections"),
        "admission": adm,
    }


def pair_delta(a: dict, b: dict, path_keys):
    """逐指标 Δ_i=(B−A)/A；None → None。"""
    out = {}
    for name, ka, kb in path_keys:
        va, vb = a, b
        try:
            for k in ka:
                va = va[k]
            for k in kb:
                vb = vb[k]
        except (KeyError, TypeError):
            va = vb = None
        if va is None or vb is None or (isinstance(va, (int, float)) and va == 0):
            out[name] = {"a": va, "b": vb, "delta": None}
        else:
            out[name] = {"a": va, "b": vb, "delta": (vb - va) / va}
    return out


METRICS = [
    ("loginP99", ["login", "p99"], ["login", "p99"]),
    ("loginP95", ["login", "p95"], ["login", "p95"]),
    ("loginP50", ["login", "p50"], ["login", "p50"]),
    ("loginMax", ["login", "max"], ["login", "max"]),
    ("cpuPerSuccess", ["resources", "cpuPerSuccessMs"], ["resources", "cpuPerSuccessMs"]),
    ("procCpuMs", ["resources", "procCpuMsWindow"], ["resources", "procCpuMsWindow"]),
    ("vmHwmKb", ["resources", "vmHwmKb"], ["resources", "vmHwmKb"]),
    ("indepSuccess", ["login", "indepDb"], ["login", "indepDb"]),
    ("saveP99", ["qos", "saveP99"], ["qos", "saveP99"]),
    ("hbP99", ["qos", "hbP99"], ["qos", "hbP99"]),
    ("startP99", ["qos", "startP99"], ["qos", "startP99"]),
    ("lastLoginOkMs", ["completion", "lastLoginOkAfterWindowStartMs"], ["completion", "lastLoginOkAfterWindowStartMs"]),
    ("lastSubmitOkMs", ["completion", "lastSubmitOkAfterWindowStartMs"], ["completion", "lastSubmitOkAfterWindowStartMs"]),
]


def main():
    pairs = []
    aa = []
    argv = sys.argv[1:]
    if not argv:
        # 默认：本目录内 aa1/aa2 + r1a/r1b...（按目录存在性发现）
        aa = [L3_ROOT / "L3-ADMISSION-A-P2-S200-aa1", L3_ROOT / "L3-ADMISSION-A-P2-S200-aa2"]
        k = 1
        while (L3_ROOT / f"L3-ADMISSION-A-P2-S200-r{k}a").exists() and (L3_ROOT / f"L3-ADMISSION-B-P2-S200-r{k}b").exists():
            pairs.append((L3_ROOT / f"L3-ADMISSION-A-P2-S200-r{k}a", L3_ROOT / f"L3-ADMISSION-B-P2-S200-r{k}b"))
            k += 1
    out_path = L3_ROOT / "l3-paired-analysis.json"

    aa_metrics = [run_metrics(p) for p in aa]
    aa_metrics = [x for x in aa_metrics if x]
    pair_metrics = []
    for pa, pb in pairs:
        ma, mb = run_metrics(pa), run_metrics(pb)
        if ma and mb:
            pair_metrics.append((ma, mb))

    # A/A 噪声地板（相对差 |aa2−aa1|/mean）
    aa_floor = {}
    if len(aa_metrics) == 2:
        x, y = aa_metrics
        for name, ka, kb in METRICS:
            va = x
            vb = y
            try:
                for k in ka:
                    va = va[k]
                for k in kb:
                    vb = vb[k]
            except (KeyError, TypeError):
                va = vb = None
            if va is not None and vb is not None and (va + vb) != 0:
                aa_floor[name] = abs(vb - va) / ((va + vb) / 2)

    # 配对 Δ
    per_pair = []
    for i, (ma, mb) in enumerate(pair_metrics, 1):
        per_pair.append({
            "pair": i,
            "a": ma["runId"], "b": mb["runId"],
            "aFailed": ma["failed"], "bFailed": mb["failed"],
            "deltas": pair_delta(ma, mb, METRICS),
            "aLogin503": ma["login"]["status503"], "bLogin503": mb["login"]["status503"],
            "bAdmission": mb["admission"],
        })

    summary = {}
    for name, _, _ in METRICS:
        ds = [pp["deltas"][name]["delta"] for pp in per_pair if pp["deltas"][name]["delta"] is not None]
        a_vals = [pp["deltas"][name]["a"] for pp in per_pair if pp["deltas"][name]["a"] is not None]
        b_vals = [pp["deltas"][name]["b"] for pp in per_pair if pp["deltas"][name]["b"] is not None]
        if ds:
            same_dir = (all(d > 0 for d in ds) or all(d < 0 for d in ds))
            summary[name] = {
                "aMedian": median(a_vals), "bMedian": median(b_vals),
                "deltaMedianPct": round(median(ds) * 100, 2),
                "deltaMinPct": round(min(ds) * 100, 2), "deltaMaxPct": round(max(ds) * 100, 2),
                "directionConsistent": same_dir, "nPairs": len(ds),
                "aaFloorPct": round(aa_floor.get(name, float("nan")) * 100, 2) if name in aa_floor else None,
            }
        else:
            summary[name] = {"aMedian": median(a_vals), "bMedian": median(b_vals),
                             "deltaMedianPct": None, "nPairs": 0}

    # 判定输入
    b_total_login_503 = sum(pp["bLogin503"] for pp in per_pair)
    b_total_login_offered = sum(pp["deltas"]["loginP99"]["b"] is not None and 0 or 0 for pp in per_pair)
    verdict = {
        "t1LoginP99ImprovePct": summary.get("loginP99", {}).get("deltaMedianPct"),
        "t1CpuPerSuccessImprovePct": (None if summary.get("cpuPerSuccess", {}).get("deltaMedianPct") is None
                                      else -summary["cpuPerSuccess"]["deltaMedianPct"]),
        "t1RssGrowthPct": summary.get("vmHwmKb", {}).get("deltaMedianPct"),
        "t3SaveP99Pct": summary.get("saveP99", {}).get("deltaMedianPct"),
        "t3HbP99Pct": summary.get("hbP99", {}).get("deltaMedianPct"),
        "bLogin503Total": b_total_login_503,
        "substantialRejections": None,  # 由调用方按 T8 口径（≥1% offered）判定
    }

    result = {
        "aaRuns": [x["runId"] for x in aa_metrics],
        "aaFloorPct": {k: round(v * 100, 2) for k, v in aa_floor.items()},
        "pairs": per_pair,
        "summary": summary,
        "verdictInputs": verdict,
        "runDetails": aa_metrics + [m for pp in pair_metrics for m in pp],
    }
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(f"[l3-paired-analysis] wrote {out_path}")
    for name, s in summary.items():
        if s.get("deltaMedianPct") is not None:
            print(f"  {name:16s} A={s['aMedian']} B={s['bMedian']} Δ={s['deltaMedianPct']:+.1f}% "
                  f"[{s['deltaMinPct']:+.1f},{s['deltaMaxPct']:+.1f}] dir={'一致' if s['directionConsistent'] else '不一致'} "
                  f"AAfloor={s.get('aaFloorPct')}")


if __name__ == "__main__":
    main()
