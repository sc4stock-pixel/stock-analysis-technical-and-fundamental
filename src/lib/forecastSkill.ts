import { ForecastSkill } from "@/types";

const URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/forecast_skill.json";

export async function fetchForecastSkill(): Promise<ForecastSkill | null> {
  try {
    const res = await fetch(URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error("fetch failed");
    return (await res.json()) as ForecastSkill;
  } catch {
    return null;
  }
}
