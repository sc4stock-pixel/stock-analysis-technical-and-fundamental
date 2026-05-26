// src/components/fundamental/format.ts

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtBps(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${Math.round(v)} bps`;
}

export function fmtPeriodLabel(endDate: string, frequency: "Q" | "H"): string {
  const [y, m] = endDate.split("-").map(Number);
  const yy = String(y).slice(2);
  if (frequency === "H") return m <= 6 ? `H1'${yy}` : `H2'${yy}`;
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `Q${q}'${yy}`;
}

export function thresholdColor(metric: "Z" | "F", value: number | null): "emerald" | "amber" | "rose" {
  if (value === null) return "amber";
  if (metric === "Z") return value > 2.99 ? "emerald" : value >= 1.81 ? "amber" : "rose";
  return value >= 7 ? "emerald" : value >= 4 ? "amber" : "rose";
}

export function tailwindBand(c: "emerald" | "amber" | "rose"): string {
  return {
    emerald: "bg-emerald-500/10 border-emerald-500/40 text-emerald-300",
    amber:   "bg-amber-500/10 border-amber-500/40 text-amber-300",
    rose:    "bg-rose-500/10 border-rose-500/40 text-rose-300",
  }[c];
}
