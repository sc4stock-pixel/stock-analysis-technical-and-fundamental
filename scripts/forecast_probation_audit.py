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
import argparse, json, math, subprocess, sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import yfinance as yf
from naive_baseline import naive_5d_pct, naive_dir, DRIFT_WINDOW

_PRICE_CACHE = {}


def price_history(ticker):
    """2y daily closes as a sorted list of (date_str, close). Cached per run."""
    if ticker in _PRICE_CACHE:
        return _PRICE_CACHE[ticker]
    try:
        raw = yf.Ticker(ticker).history(period="2y")
        hist = [(idx.strftime("%Y-%m-%d"), round(float(c), 4))
                for idx, c in raw["Close"].items()]
    except Exception as e:
        print(f"  price_history({ticker}) failed: {e}")
        hist = []
    _PRICE_CACHE[ticker] = hist
    return hist


def closes_upto(ticker, date_str):
    return [c for d, c in price_history(ticker) if d <= date_str]

FILES = {"KRONOS": "kronos_forecasts.json", "TIMESFM": "timesfm_forecasts.json"}
HORIZONS = {"2d": 2, "5d": 5, "10d": 10, "15d": 15, "20d": 20}  # bday offset -> p50[h-1]
MATCH_TOL_DAYS = 4                           # realized-day match tolerance (holidays)
# Loud guard: the audit walks the git history of kronos_forecasts.json. If the runner
# checked out a shallow clone (history truncated), the buckets are tiny and a NO_EDGE
# verdict would be a sampling ARTIFACT, not a result. Below this many snapshots we emit
# INSUFFICIENT (badge: "gathering track record") instead of a misleading NO_EDGE, and
# warn loudly. (Bug 2026-06-30: GHA emitted history_days=2 despite 31 snapshots on main.)
MIN_HISTORY_SNAPS = 10
# Conviction buckets for the 5d horizon. The 2026-06-24 audit found Kronos's 5d
# directional accuracy is driven by the SIZE of the predicted move, not the horizon:
# small predicted moves are noise, large ones carry signal. The probation keep/kill
# test (2026-07-22) is whether the high-conviction bucket holds, NOT the 20d number.
CONVICTION_HORIZON = 5
CONVICTION_BUCKETS = [("|f|<2%", 0.0, 2.0), ("2-5%", 2.0, 5.0), (">5%", 5.0, 1e9)]


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


def _stat(hits, n):
    """Package a single stat bucket for JSON output."""
    if n == 0:
        return None
    lo, hi = wilson(hits, n)
    return {"hits": hits, "n": n, "rate": round(hits / n, 4),
            "ci_lo": round(lo, 4), "ci_hi": round(hi, 4),
            "p": round(binom_p(hits, n), 4)}


BUCKET_KEY = {"|f|<2%": "lt2", "2-5%": "2to5", ">5%": "gt5"}
HORIZON_KEY = {"2d": "2d", "5d": "5d", "10d": "10d", "15d": "15d", "20d": "20d"}


def _verdict(gt5, horizons, naive_gt5_rate):
    """Classify model skill vs naive baseline."""
    def clears(s, nmin):
        return (s and s["rate"] > 0.5 and s["p"] < 0.05
                and s["ci_lo"] > 0.5 and s["n"] >= nmin
                and (naive_gt5_rate is None or s["rate"] > naive_gt5_rate))
    if clears(gt5, 20):
        return "EDGE_HIGH_CONVICTION"
    if any(clears(horizons.get(h), 30) for h in horizons):
        return "EDGE_BROAD"
    return "NO_EDGE" if any(horizons.get(h) for h in horizons) else "INSUFFICIENT"


def _build_skill_dict(all_model_data, naive_data, kronos_snaps):
    """Build the forecast_skill.json dict from collected audit data."""
    shallow = kronos_snaps < MIN_HISTORY_SNAPS
    if shallow:
        print(f"WARNING: only {kronos_snaps} kronos snapshots walked "
              f"(< {MIN_HISTORY_SNAPS}) — likely a shallow checkout. Forcing model "
              f"verdicts to INSUFFICIENT so a history glitch can't masquerade as NO_EDGE.",
              file=sys.stderr)
    hkt = timezone(timedelta(hours=8))
    result = {
        "_metadata": {
            "conviction_pct": 5.0,
            "drift_window": DRIFT_WINDOW,
            "generated_at_hk": datetime.now(hkt).strftime("%Y-%m-%d %H:%M HKT"),
            "history_days": kronos_snaps,
            "match_tol_days": MATCH_TOL_DAYS,
        }
    }

    # Naive gt5 rate for the beat-naive gate
    naive_gt5 = _stat(*naive_data["conv"][">5%"])
    naive_gt5_rate = naive_gt5["rate"] if naive_gt5 else None

    # NAIVE entry
    naive_horizons = {"5d": _stat(*naive_data["h5"])}
    naive_buckets = {BUCKET_KEY[b]: _stat(*naive_data["conv"][b])
                     for b in naive_data["conv"]}
    result["NAIVE"] = {
        "verdict": "BASELINE",
        "horizons": naive_horizons,
        "conviction_5d": naive_buckets,
    }

    # Model entries
    for model in ("KRONOS", "TIMESFM"):
        md = all_model_data.get(model)
        if not md:
            result[model] = {"verdict": "INSUFFICIENT", "horizons": {}, "conviction_5d": {}}
            continue
        horizons = {HORIZON_KEY[h]: _stat(md["stats"][h][0], md["stats"][h][1])
                    for h in md["stats"]}
        buckets = {BUCKET_KEY[b]: _stat(*md["conv"][b])
                   for b in md["conv"]}
        gt5 = buckets.get("gt5")
        # TIMESFM: no naive gate needed (pass None)
        ngr = naive_gt5_rate if model == "KRONOS" else None
        v = "INSUFFICIENT" if shallow else _verdict(gt5, horizons, ngr)
        result[model] = {
            "verdict": v,
            "horizons": horizons,
            "conviction_5d": buckets,
        }

    return result


def audit(emit_skill_json=None):
    print("FORECAST PROBATION AUDIT — true out-of-sample, from git history")
    print(f"(run {datetime.now():%Y-%m-%d %H:%M})  match tol = +/-{MATCH_TOL_DAYS}d\n")
    # Collect Kronos 5d scored pairs for the naive baseline pass.
    kronos_5d_pairs = []   # [(ticker, ld, base, rclose), ...]
    all_model_data = {}
    for model, path in FILES.items():
        realized = build_realized(model)
        # stats[horizon] = [dir_hits, n, sum_abs_pct_err]
        stats = {h: [0, 0, 0.0] for h in HORIZONS}
        mkt = {h: {"US": [0, 0], "HK": [0, 0]} for h in HORIZONS}  # per-market hits
        conv = {b[0]: [0, 0] for b in CONVICTION_BUCKETS}          # 5d conviction buckets
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
                    hit = sign(fc - base) == sign(rclose - base)
                    stats[hname][0] += hit
                    stats[hname][1] += 1
                    stats[hname][2] += abs(fc - rclose) / base * 100
                    m = "HK" if tkr.endswith(".HK") else "US"
                    mkt[hname][m][0] += hit
                    mkt[hname][m][1] += 1
                    if hbd == CONVICTION_HORIZON:
                        if model == "KRONOS":
                            kronos_5d_pairs.append((tkr, ld, base, rclose))
                        pm = abs(fc - base) / base * 100  # predicted move size
                        for bname, lo, hi in CONVICTION_BUCKETS:
                            if lo <= pm < hi:
                                conv[bname][0] += hit
                                conv[bname][1] += 1
                                break

        print(f"========== {model}  ({snaps} daily snapshots in history) ==========")
        print(f"  {'horizon':<8}{'hit-rate':>16}{'95% CI':>16}{'p vs50%':>10}{'MAE%':>9}"
              f"{'US':>11}{'HK':>11}")
        for hname in HORIZONS:
            hits, n, errsum = stats[hname]
            if n == 0:
                print(f"  {hname:<8}{'(not matured yet)':>16}")
                continue
            lo, hi = wilson(hits, n)
            uk, un = mkt[hname]["US"]; hk, hn = mkt[hname]["HK"]
            us_s = f"{uk/un*100:.0f}%({un})" if un else "-"
            hk_s = f"{hk/hn*100:.0f}%({hn})" if hn else "-"
            print(f"  {hname:<8}{f'{hits}/{n} ({hits/n*100:.0f}%)':>16}"
                  f"{f'[{lo*100:.0f},{hi*100:.0f}]':>16}{binom_p(hits, n):>10.2f}"
                  f"{errsum/n:>8.1f}%{us_s:>11}{hk_s:>11}")
        # Conviction buckets at the 5d horizon — the probation keep/kill criterion.
        print(f"  {CONVICTION_HORIZON}d conditioned on predicted move size (CONVICTION):")
        for bname, _, _ in CONVICTION_BUCKETS:
            k, n = conv[bname]
            if n == 0:
                print(f"     {bname:<8} (none)")
                continue
            lo, hi = wilson(k, n)
            edge = " <-- EDGE" if (lo > 0.5 and binom_p(k, n) < 0.05) else ""
            print(f"     {bname:<8} {k}/{n} = {k/n*100:.0f}%  "
                  f"CI[{lo*100:.0f},{hi*100:.0f}]  p={binom_p(k, n):.2f}{edge}")
        print()
        all_model_data[model] = {"stats": dict(stats), "conv": dict(conv), "snaps": snaps}
    # --- NAIVE drift baseline, scored on the exact same (ticker, date) pairs as Kronos 5d ---
    naive_h5 = [0, 0]
    naive_conv = {b[0]: [0, 0] for b in CONVICTION_BUCKETS}
    naive_skip = 0
    for tkr, ld, base, rclose in kronos_5d_pairs:
        closes = closes_upto(tkr, ld)
        nd = naive_dir(closes)
        if nd is None:
            naive_skip += 1
            continue
        hit = nd == sign(rclose - base)
        naive_h5[0] += hit
        naive_h5[1] += 1
        npct = naive_5d_pct(closes)
        pm = abs(npct) if npct is not None else 0.0
        for bname, blo, bhi in CONVICTION_BUCKETS:
            if blo <= pm < bhi:
                naive_conv[bname][0] += hit
                naive_conv[bname][1] += 1
                break
    print(f"========== NAIVE DRIFT BASELINE  (same {len(kronos_5d_pairs)} Kronos 5d pairs, "
          f"{naive_skip} skipped for <{DRIFT_WINDOW} closes) ==========")
    k, n = naive_h5
    if n:
        lo, hi = wilson(k, n)
        print(f"  5d       {f'{k}/{n} ({k/n*100:.0f}%)':>16}"
              f"{f'[{lo*100:.0f},{hi*100:.0f}]':>16}{binom_p(k, n):>10.2f}")
    else:
        print("  5d       (no scorable pairs)")
    print(f"  5d conditioned on naive predicted move size (CONVICTION):")
    for bname, _, _ in CONVICTION_BUCKETS:
        bk, bn = naive_conv[bname]
        if bn == 0:
            print(f"     {bname:<8} (none)")
            continue
        lo, hi = wilson(bk, bn)
        print(f"     {bname:<8} {bk}/{bn} = {bk/bn*100:.0f}%  "
              f"CI[{lo*100:.0f},{hi*100:.0f}]  p={binom_p(bk, bn):.2f}")
    print()
    print("KEEP/KILL (probation): a model earns KEEP only if some horizon OR the")
    print(">5% conviction bucket shows >50% with p<0.05 AND CI lower-bound >50%.")
    print("Caveat: daily forecasts overlap, so effective n << reported n — treat a")
    print("lone significant bucket as a hypothesis, weight by breadth across tickers.")

    # --- Emit forecast_skill.json if requested ---
    if emit_skill_json:
        naive_data = {"h5": list(naive_h5), "conv": dict(naive_conv)}
        kronos_snaps = all_model_data.get("KRONOS", {}).get("snaps", 0)
        skill = _build_skill_dict(all_model_data, naive_data, kronos_snaps)
        with open(emit_skill_json, "w") as f:
            json.dump(skill, f, indent=2, allow_nan=False)
        print(f"\nWrote {emit_skill_json}  (KRONOS verdict: {skill['KRONOS']['verdict']})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit-skill-json", metavar="PATH",
                        help="Write forecast_skill.json to PATH after audit")
    args = parser.parse_args()
    audit(emit_skill_json=args.emit_skill_json)
