#!/usr/bin/env python3
"""
Forecast probation audit — TRUE out-of-sample scorecard for Kronos & TimesFM.

Unlike the per-snapshot `historical` block (an in-sample backcast regenerated each
run), this walks the git history of kronos_forecasts.json / timesfm_forecasts.json,
extracts the FORWARD forecast that was actually made on each past day, and grades it
against the realized close that later materialized — the honest test.

Realized prices are reconstructed from the union of all snapshots' top-level
last_price/last_date (same data source, no network). Forecast horizons (5/10/20
business days) are matched to the nearest realized trading day within a tolerance.

Run from repo root:  python3 scripts/forecast_probation_audit.py
No writes, no network. Re-runnable any time; coverage grows as history accumulates.
"""
import json, math, subprocess, sys
from collections import defaultdict
from datetime import datetime, timedelta

FILES = {"KRONOS": "kronos_forecasts.json", "TIMESFM": "timesfm_forecasts.json"}
HORIZONS = {"5d": 5, "10d": 10, "20d": 20}   # business-day offsets -> p50 index h-1
MATCH_TOL_DAYS = 4                           # realized-day match tolerance (holidays)


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def commits_for(path):
    """List of (sha, date) for every commit touching path, oldest first."""
    out = sh("git", "log", "--reverse", "--format=%H|%ad", "--date=short", "--", path)
    rows = []
    for line in out.strip().splitlines():
        sha, date = line.split("|")
        rows.append((sha, date))
    return rows


def load_blob(sha, path):
    raw = sh("git", "show", f"{sha}:{path}")
    if not raw.strip():
        return None
    raw = raw.replace("NaN", "null").replace("Infinity", "null")  # JS-parity guard
    try:
        return json.loads(raw)
    except Exception:
        return None


def fwd_path(entry):
    """Extract the 20-step forward p50 path from either model's schema."""
    if "forward" in entry and isinstance(entry["forward"], dict):
        return entry["forward"].get("p50")            # Kronos
    pt = entry.get("price_targets")
    if isinstance(pt, dict):
        return pt.get("p50")                           # TimesFM
    return None


def sign(x):
    return (x > 0) - (x < 0)


def build_realized(model):
    """ticker -> sorted list of (date, close) from every snapshot's last_price."""
    series = defaultdict(dict)
    for sha, _ in commits_for(FILES[model]):
        d = load_blob(sha, FILES[model])
        if not d:
            continue
        for tkr, e in d.items():
            if tkr == "_metadata" or not isinstance(e, dict):
                continue
            lp, ld = e.get("last_price"), e.get("last_date")
            if lp is not None and ld:
                series[tkr][ld] = round(float(lp), 4)
    return {t: sorted(m.items()) for t, m in series.items()}


def realized_at(series, target_date):
    """Nearest realized (date, close) to target within tolerance, or None."""
    tgt = datetime.strptime(target_date, "%Y-%m-%d")
    best = None
    for d, c in series:
        delta = abs((datetime.strptime(d, "%Y-%m-%d") - tgt).days)
        if delta <= MATCH_TOL_DAYS and (best is None or delta < best[0]):
            best = (delta, d, c)
    return (best[1], best[2]) if best else None


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def binom_p(k, n, p=0.5):
    if n == 0:
        return 1.0
    z = (k - n * p) / math.sqrt(n * p * (1 - p))
    return math.erfc(abs(z) / math.sqrt(2))


def audit():
    print("FORECAST PROBATION AUDIT — true out-of-sample, from git history")
    print(f"(run {datetime.now():%Y-%m-%d %H:%M})  match tol = +/-{MATCH_TOL_DAYS}d\n")
    for model, path in FILES.items():
        realized = build_realized(model)
        # stats[horizon] = [dir_hits, n, sum_abs_pct_err]
        stats = {h: [0, 0, 0.0] for h in HORIZONS}
        snaps = 0
        for sha, fdate in commits_for(path):
            d = load_blob(sha, path)
            if not d:
                continue
            snaps += 1
            for tkr, e in d.items():
                if tkr == "_metadata" or not isinstance(e, dict):
                    continue
                p50 = fwd_path(e)
                base = e.get("last_price")
                ld = e.get("last_date")
                if not p50 or base is None or not ld or len(p50) < 20:
                    continue
                base = float(base)
                series = realized.get(tkr, [])
                for hname, hbd in HORIZONS.items():
                    fc = float(p50[hbd - 1])
                    target = (datetime.strptime(ld, "%Y-%m-%d")
                              + timedelta(days=round(hbd * 7 / 5))).strftime("%Y-%m-%d")
                    r = realized_at(series, target)
                    if not r:
                        continue
                    _, rclose = r
                    if sign(rclose - base) == 0:
                        continue
                    stats[hname][0] += sign(fc - base) == sign(rclose - base)
                    stats[hname][1] += 1
                    stats[hname][2] += abs(fc - rclose) / base * 100

        print(f"========== {model}  ({snaps} daily snapshots in history) ==========")
        print(f"  {'horizon':<8}{'hit-rate':>16}{'95% CI':>16}{'p vs50%':>10}{'MAE%':>9}")
        for hname in HORIZONS:
            hits, n, errsum = stats[hname]
            if n == 0:
                print(f"  {hname:<8}{'(not matured yet)':>16}")
                continue
            lo, hi = wilson(hits, n)
            print(f"  {hname:<8}{f'{hits}/{n} ({hits/n*100:.0f}%)':>16}"
                  f"{f'[{lo*100:.0f},{hi*100:.0f}]':>16}{binom_p(hits, n):>10.2f}"
                  f"{errsum/n:>8.1f}%")
        print()
    print("Read: hit-rate >50% with p<0.05 and CI lower-bound >50% = real edge.")
    print("Anything spanning 50% = no detectable skill (coin flip).")


if __name__ == "__main__":
    audit()
