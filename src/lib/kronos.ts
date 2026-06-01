import { KronosForecasts } from "@/types";

export async function fetchKronosForecasts(): Promise<KronosForecasts | null> {
  try {
    const url =
      "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/kronos_forecasts.json";
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("fetch failed");
    const raw = (await res.json()) as Record<string, unknown>;

    const out: KronosForecasts = {};
    for (const [symbol, data] of Object.entries(raw)) {
      if (symbol.startsWith("_") || !data) continue;
      const d = data as KronosForecasts[string];
      if (d.forward && Array.isArray(d.forward.p50) && d.forward.p50.length > 0) {
        out[symbol] = d;
      }
    }
    return out;
  } catch {
    return null;
  }
}
