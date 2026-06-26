# Forecast 5d-Conviction Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `dir_hits/20` forecast accuracy display with a 5d-primary, conviction-gated, naive-benchmarked, honest model-level skill display across all six surfaces.

**Architecture:** Approach B — centralize display *logic* in shared helpers (`forecastBox.ts` for TS, `report/forecast_display.py` for Python) and add one new derived data file `forecast_skill.json` (true-OOS skill numbers) emitted by the probation harness and read by every surface. Naive 60d-drift baseline replaces TimesFM as the on-screen benchmark. TimesFM stays generated (for probation through 2026-07-22) but is removed from display.

**Tech Stack:** Next.js 14 / TypeScript / React (web, repo `stock-analysis-technical-and-fundamental`), Python 3 (harness `scripts/`, generators, GitHub Actions), Python report (`report/cards.py` in the separate repo `/Users/Steven/Claude/GitHub/stock_analysis`), vitest, pytest.

**Hard constraints (do not violate):**
- Forecast generators (`scripts/kronos_predict.py`, `scripts/timesfm_predict.py`) keep emitting the **full 20-point** forward path and their **daily commit cadence** — "5d" is display-only.
- `timesfm.yml` keeps running through **2026-07-22**; do not delete TimesFM generation.
- Cross-surface parity: any change to one surface's forecast display must be mirrored to the others in the same effort.
- Web app is Clerk-gated — final visual verification is a signed-in **Vercel Preview**, never local.

**Repos & branches:**
- Web work on branch `feat/forecast-5d-conviction` cut from `origin/main` of `stock-analysis-technical-and-fundamental`.
- Python-report work on a branch in `/Users/Steven/Claude/GitHub/stock_analysis` (remote is a stub; commit locally, rsync backs it up).

---

## File structure

| File | Repo | Responsibility |
|---|---|---|
| `scripts/forecast_probation_audit.py` | web | Add naive baseline scoring + `--emit-skill-json` writing `forecast_skill.json` |
| `scripts/naive_baseline.py` | web | NEW — pure 60d-drift baseline (imported by harness) |
| `forecast_skill.json` | web | NEW — derived skill data (committed daily by GHA) |
| `.github/workflows/kronos.yml` | web | Add step: run harness `--emit-skill-json`, commit the file |
| `src/types/index.ts` | web | Add `ForecastSkill` types; add `naive` to row types |
| `src/lib/forecastBox.ts` | web | Add `naiveRow`, `convictionFlag`, `skillBadge`, `agreement(k,naive)`; 5d-primary |
| `src/lib/forecastBox.test.ts` | web | Tests for all new helpers |
| `src/lib/forecastSkill.ts` | web | NEW — fetch+parse `forecast_skill.json` (raw-GitHub, 6h TTL) |
| `src/components/StockCard.tsx` | web | Panel → "Kronos Prediction", 5d hero, flags, naive, skill badge |
| `src/components/PortfolioSummaryBar.tsx` | web | `K 5d` + `naive 5d` cols; drop TFM + `acc /20` |
| `src/components/tabs/ChartTab.tsx` | web | Primary forward line → Kronos; naive dashed ref |
| `src/lib/telegram-report.ts` | web | `buildForecastSection` → 5d + naive + skill footer |
| `report/forecast_display.py` | stock_analysis | NEW — Python mirror of conviction/naive/skill rules |
| `report/cards.py` | stock_analysis | Accuracy caption + TimesFM panel → Kronos 5d + naive |

---

## Phase 1 — Harness: naive baseline + `forecast_skill.json`

### Task 1: Naive 60d-drift baseline module

**Files:**
- Create: `scripts/naive_baseline.py`
- Test: `scripts/test_naive_baseline.py`

- [ ] **Step 1: Write the failing test**

```python
# scripts/test_naive_baseline.py
import math
from naive_baseline import naive_5d_pct, naive_dir, DRIFT_WINDOW

def test_drift_window_is_60():
    assert DRIFT_WINDOW == 60

def test_flat_series_gives_zero_drift():
    closes = [100.0] * 80
    assert abs(naive_5d_pct(closes)) < 1e-9
    assert naive_dir(closes) == 0

def test_uptrend_gives_positive_5d_and_up_dir():
    # +0.1%/day compounded over the window
    closes = [100.0 * (1.001 ** i) for i in range(80)]
    pct = naive_5d_pct(closes)
    assert pct > 0
    assert naive_dir(closes) == 1
    # ~ (exp(0.001*5)-1)*100 ≈ 0.50%
    assert abs(pct - (math.exp(0.001 * 5) - 1) * 100) < 0.05

def test_too_short_series_returns_none():
    assert naive_5d_pct([100.0] * 10) is None
    assert naive_dir([100.0] * 10) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python3 -m pytest test_naive_baseline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'naive_baseline'`

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/naive_baseline.py
"""Naive random-walk-with-drift baseline — the benchmark Kronos must beat.

drift      = mean daily log-return over the trailing DRIFT_WINDOW closes
naive 5d % = (exp(drift * 5) - 1) * 100   ;   naive dir = sign(drift)

Pure + dependency-light so the web TS helper (forecastBox.ts) mirrors it exactly.
Keep in lockstep with forecastBox.ts naiveRow() — PARITY.
"""
import math

DRIFT_WINDOW = 60   # trailing trading days
HORIZON = 5         # business days ahead


def _drift(closes):
    if closes is None or len(closes) < DRIFT_WINDOW + 1:
        return None
    window = closes[-(DRIFT_WINDOW + 1):]
    rets = [math.log(window[i] / window[i - 1])
            for i in range(1, len(window)) if window[i - 1] > 0 and window[i] > 0]
    if not rets:
        return None
    return sum(rets) / len(rets)


def naive_5d_pct(closes):
    d = _drift(closes)
    return None if d is None else (math.exp(d * HORIZON) - 1) * 100


def naive_dir(closes):
    d = _drift(closes)
    if d is None:
        return None
    return (d > 0) - (d < 0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && python3 -m pytest test_naive_baseline.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/naive_baseline.py scripts/test_naive_baseline.py
git commit -m "feat(harness): add naive 60d-drift baseline module"
```

---

### Task 2: Harness scores the naive baseline alongside Kronos/TimesFM

**Files:**
- Modify: `scripts/forecast_probation_audit.py`

Context: the harness already reconstructs a realized `series` per ticker. For the naive baseline it needs ~60 closes *before* each forecast date, which snapshot reconstruction may lack early on. Fetch a 2y daily close series per ticker via yfinance (cached), and use it for BOTH the naive drift and (preferably) realized-price matching.

- [ ] **Step 1: Add a cached price-history fetch**

Add near the top of `scripts/forecast_probation_audit.py` (after imports):

```python
import yfinance as yf
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
```

- [ ] **Step 2: Add a naive-scoring pass keyed off the same forecast dates**

In `audit()`, where each model's per-horizon stats are accumulated, add a parallel `NAIVE` accumulation that, for each (ticker, forecast-date `ld`), computes the naive 5d call from `price_history` closes up to `ld`, then grades it against the same realized close used for the model. Import at top: `from naive_baseline import naive_5d_pct, naive_dir, DRIFT_WINDOW`. Reuse the existing realized-match + `sign` helpers.

```python
def closes_upto(ticker, date_str):
    return [c for d, c in price_history(ticker) if d <= date_str]
```

Accumulate into a `naive_conv = {b[0]: [0,0] for b in CONVICTION_BUCKETS}` and `naive_h5 = [0,0]` scored on the SAME (ticker, ld) pairs Kronos is scored on at the 5d horizon, so the comparison is apples-to-apples.

- [ ] **Step 3: Run the harness, eyeball output**

Run: `python3 scripts/forecast_probation_audit.py`
Expected: prints a `NAIVE` line with a 5d hit-rate (~50%), no crash.

- [ ] **Step 4: Commit**

```bash
git add scripts/forecast_probation_audit.py
git commit -m "feat(harness): score naive baseline on the same 5d calls as Kronos"
```

---

### Task 3: Harness emits `forecast_skill.json`

**Files:**
- Modify: `scripts/forecast_probation_audit.py`
- Test: `scripts/test_skill_json.py`

- [ ] **Step 1: Write the failing test**

```python
# scripts/test_skill_json.py
import json, subprocess, os

def test_emit_skill_json(tmp_path):
    out = tmp_path / "forecast_skill.json"
    subprocess.run(
        ["python3", "scripts/forecast_probation_audit.py",
         "--emit-skill-json", str(out)],
        check=True)
    d = json.loads(out.read_text())
    assert "_metadata" in d and d["_metadata"]["conviction_pct"] == 5.0
    assert d["_metadata"]["drift_window"] == 60
    for model in ("KRONOS", "NAIVE", "TIMESFM"):
        assert model in d
        assert "verdict" in d[model]
    assert d["NAIVE"]["verdict"] == "BASELINE"
    # verdict enum is one of the allowed values
    allowed = {"EDGE_HIGH_CONVICTION","EDGE_BROAD","NO_EDGE","INSUFFICIENT","BASELINE"}
    assert d["KRONOS"]["verdict"] in allowed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest scripts/test_skill_json.py -v`
Expected: FAIL — `--emit-skill-json` not recognized / file not written.

- [ ] **Step 3: Implement the emitter + verdict logic**

Add an `argparse` flag and a `build_skill_dict()` that packages the per-horizon stats, the 5d conviction buckets (Kronos + Naive), and a `verdict` per the enum. Verdict rules (spec §5.3), with the **beat-naive gate**:

```python
def _stat(hits, n):
    if n == 0:
        return None
    lo, hi = wilson(hits, n)
    return {"hits": hits, "n": n, "rate": round(hits/n, 4),
            "ci_lo": round(lo, 4), "ci_hi": round(hi, 4), "p": round(binom_p(hits, n), 4)}

def _verdict(model_conv_gt5, model_horizons, naive_rate_5d):
    gt5 = model_conv_gt5
    def clears(s, nmin):
        return s and s["rate"] > 0.5 and s["p"] < 0.05 and s["ci_lo"] > 0.5 and s["n"] >= nmin \
               and (naive_rate_5d is None or s["rate"] > naive_rate_5d)
    if clears(gt5, 20):
        return "EDGE_HIGH_CONVICTION"
    if any(clears(model_horizons.get(h), 30) for h in model_horizons):
        return "EDGE_BROAD"
    matured = any(model_horizons.get(h) for h in model_horizons)
    return "NO_EDGE" if matured else "INSUFFICIENT"
```

Write with `json.dump(..., allow_nan=False)` (fail loud on non-finite — JS-parity guard). NAIVE's verdict is hard-coded `"BASELINE"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest scripts/test_skill_json.py -v`
Expected: PASS

- [ ] **Step 5: Generate the real file + commit**

```bash
python3 scripts/forecast_probation_audit.py --emit-skill-json forecast_skill.json
git add scripts/forecast_probation_audit.py scripts/test_skill_json.py forecast_skill.json
git commit -m "feat(harness): emit forecast_skill.json (true-OOS skill + verdict)"
```

---

### Task 4: GHA step commits `forecast_skill.json` daily

**Files:**
- Modify: `.github/workflows/kronos.yml`

- [ ] **Step 1: Add a step after the forecast commit**

After the existing "commit kronos_forecasts.json" step, add (matching the workflow's existing python/setup):

```yaml
      - name: Update forecast_skill.json
        run: |
          python3 scripts/forecast_probation_audit.py --emit-skill-json forecast_skill.json
          if ! git diff --quiet forecast_skill.json; then
            git config user.name "github-actions"
            git config user.email "actions@github.com"
            git add forecast_skill.json
            git commit -m "Update forecast skill"
            git push
          fi
```

- [ ] **Step 2: Validate YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/kronos.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/kronos.yml
git commit -m "ci(kronos): emit + commit forecast_skill.json daily"
```

> NOTE: do not touch `timesfm.yml` — it keeps running through 2026-07-22.

---

## Phase 2 — Shared helpers + types

### Task 5: Types for skill + naive

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add types** (after `ForecastHistorical`):

```typescript
export type ForecastVerdict =
  | "EDGE_HIGH_CONVICTION" | "EDGE_BROAD" | "NO_EDGE" | "INSUFFICIENT" | "BASELINE";

export interface SkillStat {
  hits: number; n: number; rate: number; ci_lo: number; ci_hi: number; p: number;
}
export interface ModelSkill {
  horizons: Record<string, SkillStat | null>;
  conviction_5d: Record<"lt2" | "2to5" | "gt5", SkillStat | null>;
  verdict: ForecastVerdict;
}
export interface ForecastSkill {
  _metadata: { conviction_pct: number; drift_window: number; generated_at_hk: string;
               history_days: number; match_tol_days: number };
  KRONOS: ModelSkill; NAIVE: ModelSkill; TIMESFM: ModelSkill;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no new errors.

```bash
git add src/types/index.ts
git commit -m "types: ForecastSkill + ModelSkill for forecast_skill.json"
```

---

### Task 6: `forecastBox.ts` — naive row, conviction/reliability flags, 5d-primary, skill badge

**Files:**
- Modify: `src/lib/forecastBox.ts`
- Test: `src/lib/forecastBox.test.ts`

- [ ] **Step 1: Write failing tests** (append to `forecastBox.test.ts`):

```typescript
import { naiveRow, convictionFlags, skillBadge, CONVICTION_PCT } from "./forecastBox";

describe("naiveRow", () => {
  it("computes 5d drift % from 60d window", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 * 1.001 ** i);
    const r = naiveRow(closes)!;
    expect(r.cells[0]!.pct).toBeCloseTo((Math.exp(0.001 * 5) - 1) * 100, 1);
  });
  it("returns null when series too short", () => {
    expect(naiveRow(Array(10).fill(100))).toBeNull();
  });
});

describe("convictionFlags", () => {
  it("HIGH when |5d%| > 5", () => {
    expect(convictionFlags({ pct: 6.3, price: 1 } as any, 2).high).toBe(true);
  });
  it("low when |5d%| <= 5", () => {
    expect(convictionFlags({ pct: 2.1, price: 1 } as any, 2).high).toBe(false);
  });
  it("warns when relMae large; flags coexist", () => {
    const f = convictionFlags({ pct: -8.1, price: 1 } as any, 30);
    expect(f.high).toBe(true);
    expect(f.unreliable).toBe(true);
  });
});

describe("skillBadge", () => {
  it("provisional edge text for EDGE_HIGH_CONVICTION", () => {
    const b = skillBadge({ verdict: "EDGE_HIGH_CONVICTION",
      conviction_5d: { gt5: { rate: 0.81 } } } as any, { conviction_5d: { gt5: { rate: 0.52 } } } as any);
    expect(b.label).toMatch(/provisional/i);
    expect(b.detail).toMatch(/81%/);
    expect(b.detail).toMatch(/52%/);
  });
  it("no-edge label for NO_EDGE", () => {
    expect(skillBadge({ verdict: "NO_EDGE" } as any, null).tone).toBe("muted");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test -- forecastBox`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement** (add to `forecastBox.ts`; keep existing exports):

```typescript
export const CONVICTION_PCT = 5.0;       // PARITY with scripts/naive_baseline + harness
export const REL_MAE_WARN = 15.0;        // % relative MAE → low-reliability ⚠
const DRIFT_WINDOW = 60, HORIZON = 5;

/** Naive drift baseline from a close series (oldest→newest). cells:[5d,null,null]. */
export function naiveRow(closes: number[] | undefined): ForecastRowData | null {
  if (!closes || closes.length < DRIFT_WINDOW + 1) return null;
  const w = closes.slice(-(DRIFT_WINDOW + 1));
  const rets: number[] = [];
  for (let i = 1; i < w.length; i++)
    if (w[i - 1] > 0 && w[i] > 0) rets.push(Math.log(w[i] / w[i - 1]));
  if (!rets.length) return null;
  const drift = rets.reduce((a, b) => a + b, 0) / rets.length;
  const price = w[w.length - 1] * Math.exp(drift * HORIZON);
  return { cells: [cell(price, w[w.length - 1]), null, null], dirHits: null };
}

export interface Flags { high: boolean; unreliable: boolean; }
/** Conviction (|5d%|>threshold) + reliability (recent relMae). Independent — both can show. */
export function convictionFlags(c5d: ForecastCell | null, relMaePct: number | null): Flags {
  return {
    high: !!c5d && Math.abs(c5d.pct) > CONVICTION_PCT,
    unreliable: relMaePct != null && relMaePct > REL_MAE_WARN,
  };
}

export interface Badge { tone: "edge" | "muted" | "pending"; label: string; detail: string; }
export function skillBadge(k: ModelSkill | null, naive: ModelSkill | null): Badge {
  const kr = k?.conviction_5d?.gt5?.rate, nr = naive?.conviction_5d?.gt5?.rate;
  const detail = kr != null
    ? `hi-conv ${Math.round(kr * 100)}%${nr != null ? ` vs naive ${Math.round(nr * 100)}%` : ""}`
    : "";
  switch (k?.verdict) {
    case "EDGE_HIGH_CONVICTION":
    case "EDGE_BROAD":
      return { tone: "edge", label: "Edge on high-conviction calls (provisional)", detail };
    case "INSUFFICIENT":
      return { tone: "pending", label: "Gathering track record", detail };
    default:
      return { tone: "muted", label: "No measured edge", detail };
  }
}
```

Add `import { ModelSkill } from "@/types";` at top. Update `ForecastRowData.cells` doc to note `[0]` = 5d primary.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- forecastBox`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecastBox.ts src/lib/forecastBox.test.ts
git commit -m "feat(forecastBox): naiveRow, conviction+reliability flags, skillBadge"
```

---

### Task 7: `forecastSkill.ts` reader

**Files:**
- Create: `src/lib/forecastSkill.ts`

- [ ] **Step 1: Implement** (mirror the existing timesfm fetch in the codebase — find it with `grep -rn "timesfm_forecasts.json" src/lib`):

```typescript
import { ForecastSkill } from "@/types";
const URL = "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/forecast_skill.json";

export async function fetchForecastSkill(): Promise<ForecastSkill | null> {
  try {
    const res = await fetch(URL, { next: { revalidate: 21600 } });
    if (!res.ok) return null;
    const txt = (await res.text()).replace(/\bNaN\b/g, "null");
    return JSON.parse(txt) as ForecastSkill;
  } catch { return null; }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → no new errors.

```bash
git add src/lib/forecastSkill.ts
git commit -m "feat: forecast_skill.json reader (raw-GitHub, 6h revalidate)"
```

---

### Task 8: Python parity module `report/forecast_display.py`

**Files:**
- Create (in `/Users/Steven/Claude/GitHub/stock_analysis`): `report/forecast_display.py`
- Test: `report/test_forecast_display.py`

- [ ] **Step 1: Write failing test**

```python
# report/test_forecast_display.py
from report.forecast_display import naive_5d_pct, conviction_high, CONVICTION_PCT

def test_conviction_pct_parity():
    assert CONVICTION_PCT == 5.0   # PARITY with forecastBox.ts

def test_high_conviction():
    assert conviction_high(6.3) is True
    assert conviction_high(2.1) is False

def test_naive_matches_formula():
    import math
    closes = [100.0 * (1.001 ** i) for i in range(80)]
    assert abs(naive_5d_pct(closes) - (math.exp(0.001 * 5) - 1) * 100) < 0.05
```

- [ ] **Step 2: Run, verify fail**

Run: `cd /Users/Steven/Claude/GitHub/stock_analysis && python3 -m pytest report/test_forecast_display.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (mirrors `scripts/naive_baseline.py` + forecastBox flags — PARITY comment at top):

```python
# report/forecast_display.py
"""Python mirror of web src/lib/forecastBox.ts conviction + naive rules.
PARITY: keep CONVICTION_PCT / DRIFT_WINDOW / formula identical to forecastBox.ts."""
import math
CONVICTION_PCT = 5.0
REL_MAE_WARN = 15.0
DRIFT_WINDOW = 60
HORIZON = 5

def naive_5d_pct(closes):
    if not closes or len(closes) < DRIFT_WINDOW + 1:
        return None
    w = closes[-(DRIFT_WINDOW + 1):]
    rets = [math.log(w[i]/w[i-1]) for i in range(1, len(w)) if w[i-1] > 0 and w[i] > 0]
    if not rets:
        return None
    return (math.exp((sum(rets)/len(rets)) * HORIZON) - 1) * 100

def conviction_high(pct_5d):
    return pct_5d is not None and abs(pct_5d) > CONVICTION_PCT

def reliability_warn(rel_mae_pct):
    return rel_mae_pct is not None and rel_mae_pct > REL_MAE_WARN
```

- [ ] **Step 4: Run, verify pass**

Run: `python3 -m pytest report/test_forecast_display.py -v`
Expected: PASS

- [ ] **Step 5: Commit** (local repo; remote is a stub)

```bash
git add report/forecast_display.py report/test_forecast_display.py
git commit -m "feat(report): Python mirror of forecastBox conviction+naive rules"
```

---

## Phase 3 — Web surfaces (visual design already validated)

### Task 9: StockCard "Kronos Prediction" panel

**Files:**
- Modify: `src/components/StockCard.tsx` (forecast panel ~lines 124-205, 363-365)

- [ ] **Step 1: Repoint + restructure**
  - Rename heading "Kronos & TimesFM Prediction" → "Kronos Prediction".
  - Replace `FORECAST_LABELS = ["5d","10d","20d"]` usage so **5d is the hero** (large), 10d/20d small + grey.
  - Replace the `{row.dirHits}/20 dir` line (≈ line 134) with the conviction `✦` (Tabler `ti-sparkles`-free: use the literal star or `ti-star`? → use a small bold `✦` span, green when high) and `ti-alert-triangle` for `unreliable`, computed via `convictionFlags(kRow.cells[0], relMae)`.
  - Add a `naive 5d` line beneath the Kronos number using `naiveRow(closes)` (closes from `result` history already in props — verify field name via `grep -n "Close" src/components/StockCard.tsx`).
  - Replace `agreement20(kRow,tRow)` with the skill badge from `skillBadge(skill?.KRONOS, skill?.NAIVE)` (skill passed down from page-level `fetchForecastSkill()`).
  - Remove `timesfmRow`/TimesFM cells from this panel.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: builds (needs dummy Clerk key per repo CLAUDE.md).

- [ ] **Step 3: Commit**

```bash
git add src/components/StockCard.tsx
git commit -m "feat(card): 5d-primary Kronos panel with conviction flags + skill badge"
```

---

### Task 10: PortfolioSummaryBar columns

**Files:**
- Modify: `src/components/PortfolioSummaryBar.tsx` (cols ~98-117, rows ~252-254)

- [ ] **Step 1: Swap columns**
  - Change Kronos/TimesFM sort+cells from `cells[2]` (20d) to `cells[0]` (5d).
  - Replace the `TFM 20d` column with `naive 5d` (greyed) via `naiveRow(closes)`.
  - Delete the ` · acc ${row.dirHits}/20` string (line 117).
  - Add `✦` when `convictionFlags(kRow.cells[0], relMae).high`.
  - Remove `agreement20`/`timesfmRow` imports if now unused.

- [ ] **Step 2: Typecheck + build** → `npx tsc --noEmit && npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/PortfolioSummaryBar.tsx
git commit -m "feat(portfolio): K 5d + naive 5d columns; drop TFM + /20"
```

---

### Task 11: ChartTab — Kronos as primary forward line

**Files:**
- Modify: `src/components/tabs/ChartTab.tsx` (~137, 211-257, 350)

- [ ] **Step 1: Repoint forward overlay**
  - Make Kronos `forward.p50` the primary forecast line (was TimesFM `timesfm.p50`).
  - Add the naive drift as a thin dashed reference line (single sloped segment from last close using `naiveRow`).
  - Remove the TimesFM P50 series + its purple tooltip row.
  - Track-record mode: leave the 20-bar overlay for now (true-OOS rolling track is a follow-up — note in CHANGELOG), OR if time permits, show only the last 5 bars. Keep minimal.

- [ ] **Step 2: Typecheck + build** → `npx tsc --noEmit && npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/tabs/ChartTab.tsx
git commit -m "feat(chart): Kronos primary forward line; naive dashed ref; drop TimesFM"
```

---

## Phase 4 — Telegram report + Python report

### Task 12: `buildForecastSection` → 5d + naive + skill footer

**Files:**
- Modify: `src/lib/telegram-report.ts` (~143-213, 320)
- Test: extend the telegram-report test if one exists (`grep -rn "buildForecastSection\|buildEodReport" src/lib/*.test.ts`)

- [ ] **Step 1: Write/extend failing test** asserting the rendered block contains `FORECASTS 5d`, a `naive` token, no `/20`, and a skill footer line with `provisional` when verdict is `EDGE_HIGH_CONVICTION`. (Pass a stub `ForecastSkill`.)

- [ ] **Step 2: Run, verify fail** → `npm test -- telegram-report`

- [ ] **Step 3: Implement**
  - `kPct`/`tPct` (lines 167-170): use `p50[4]`/`t1` (5d) not `[19]`. Drop TimesFM from the row (keep generating, just don't render); render `naive` 5d instead.
  - Remove `kDir`/`tDir` (`dir_hits`) and the `${x.kDir}/20` strings (192-193).
  - Header (202): `📊 FORECASTS 5d · K=Kronos vs naive drift`.
  - Append a footer from the skill JSON: `⚡ Kronos 5d (OOS, provisional): hi-conv X% vs naive Y% edge` (or `— no measured edge`).
  - `htmlEscape` any `<`/`>`; strip `.HK` from tickers (existing guardrails).

- [ ] **Step 4: Run, verify pass** → `npm test -- telegram-report`

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram-report.ts src/lib/*.test.ts
git commit -m "feat(telegram): EOD forecast block → 5d + naive + skill footer"
```

---

### Task 13: Python report caption + targets panel

**Files:**
- Modify (`/Users/Steven/Claude/GitHub/stock_analysis`): `report/cards.py` (~300-319 caption, ~731 targets panel)

- [ ] **Step 1: Replace accuracy caption** (lines 300-319): drop `dir_hits/20 · MAE`; build `Kronos 5d hi-conv X% OOS · naive Y% · ⚡edge/—` reading the new `forecast_skill.json` (add a small loader mirroring how cards.py loads other JSON; `grep -n "json.load\|forecasts" report/cards.py`). Use `report/forecast_display.py` helpers for conviction.

- [ ] **Step 2: Repoint targets panel** (line ~731): "🔮 TimesFM AI Targets (5d/10d/20d)" → "🔮 Kronos Targets (5d primary)"; pull from Kronos `forward.p50[4/9/19]`, emphasize 5d, grey 10d/20d; add naive 5d line.

- [ ] **Step 3: Render a report, eyeball**

Run: `cd /Users/Steven/Claude/GitHub/stock_analysis && python3 -c "from report import cards"` (import sanity) and a full report render if a quick entry exists.

- [ ] **Step 4: Commit**

```bash
git add report/cards.py
git commit -m "feat(report): Kronos 5d + naive caption and targets panel; drop TimesFM display"
```

---

## Phase 5 — Remove TimesFM from display + redirection sweep

### Task 14: Exhaustive TimesFM-reader classification + repoint

**Files:** all surfaces + any routine.

- [ ] **Step 1: Grep every reader**

Run (web): `grep -rn "timesfm\|TimesFM\|price_targets\|\bt1\b\|\bt2\b\|\bt3\b" src | grep -v "\.test\."`
Run (digest): `grep -rni "timesfm" src/lib src/app/api`

- [ ] **Step 2: Classify each hit** as `display-removed`, `repointed-to-Kronos`, or `kept-for-probation` (generators/harness/types only). Repoint anything where TimesFM was the *primary headline* forecast (Morning Digest is the key one — `grep -rn "timesfm" src/app/api/*digest* src/lib/*digest*`).

- [ ] **Step 3: Verify nothing user-facing still renders TimesFM**

Run: `grep -rn "TimesFM" src/components` → expect zero matches (only types/lib generation references remain).

- [ ] **Step 4: Build + commit**

```bash
npx tsc --noEmit && npm run build
git add -A src
git commit -m "refactor: remove TimesFM from all display; repoint primaries to Kronos"
```

---

## Phase 6 — Cleanup

### Task 15: Deprecate `dir_hits` readers, update types/tests/CHANGELOG/parity

**Files:** `src/lib/forecastBox.ts`, `src/types/index.ts`, tests, `CHANGELOG.md`.

- [ ] **Step 1:** Remove `dirHits` from `ForecastRowData` and the `agreement20` export if now unreferenced (`grep -rn "dirHits\|agreement20" src`). Keep `ForecastHistorical` type (generators still emit it for probation) but mark `@deprecated for display`.

- [ ] **Step 2:** Delete stale tests referencing `/20`; ensure `npm test` green.

Run: `npm test`
Expected: all pass.

- [ ] **Step 3:** Add a dated `CHANGELOG.md` entry (web) and to `/Users/Steven/Claude/GitHub/stock_analysis/CHANGELOG.md` covering: 5d flip, conviction flags, naive baseline, skill badge, TimesFM display removal (generation retained through 07-22), `forecast_skill.json`. Add parity comments at the TS↔Py mirror sites.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: deprecate dir_hits display, update tests + CHANGELOG + parity notes"
```

---

## Final verification (before merge)

- [ ] `npm test` green; `npx tsc --noEmit` clean; `npm run build` succeeds (dummy Clerk key).
- [ ] `python3 -m pytest scripts/ report/` (both repos) green.
- [ ] Harness run produces a valid `forecast_skill.json` (no NaN; verdict present).
- [ ] **Signed-in Vercel Preview visual pass** (Steven): stock card panel, portfolio columns, chart, on a per-branch Preview URL — confirm 5d hero, `✦`/`⚠` flags coexist (AMD), naive yardstick, hedged skill badge, no TimesFM anywhere on screen.
- [ ] Cross-surface parity: pick NVDA + AMD; confirm identical 5d %, flags, and badge wording across web card, portfolio bar, Telegram report, Python report.
- [ ] Confirm probation untouched: `git show origin/main:scripts/kronos_predict.py | grep -n "p50\|PRED_LEN"` still emits 20-pt path; `timesfm.yml` unchanged.

---

## Self-review notes
- Spec §4 constraint (full 20pt path preserved) → enforced in Task 9/10/11 (display reads `[0]`, data untouched) + final verification.
- Spec §5.3 beat-naive gate → Task 3 `_verdict`.
- Spec §7 redirection → Task 14 (explicit grep classification; Morning Digest called out).
- Spec §10 parity → Task 8 + Task 15 parity comments; cross-surface check in final verification.
- Type consistency: `ModelSkill`/`SkillStat`/`ForecastSkill` defined in Task 5, consumed in Tasks 6,7,9,12,13.
