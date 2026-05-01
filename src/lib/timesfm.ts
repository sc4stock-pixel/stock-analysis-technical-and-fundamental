import { TimesfmForecasts } from "@/types";

export async function fetchTimesfmForecasts(): Promise<TimesfmForecasts | null> {
  try {
    const url =
      "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/timesfm_forecasts.json";
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("fetch failed");
    return await res.json();
  } catch {
    return null;
  }
}
