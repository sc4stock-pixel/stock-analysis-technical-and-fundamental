import type { WorkerState } from "@/types/worker-state";
import { assembleDigestPrompt } from "./assemble";

const KRONOS_URL = "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/kronos_forecasts.json";

export interface DigestPromptResult { prompt: string; fetchedAt: string; dataAsOf: string | null; }

async function fetchJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000), ...init });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchWorkerState(): Promise<WorkerState> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV not configured");
  const data = await fetchJson(`${url}/get/state`, { headers: { Authorization: `Bearer ${token}` } });
  if (!data?.result) throw new Error("KV state empty");
  return JSON.parse(data.result) as WorkerState;
}

export async function generateDigestPrompt(): Promise<DigestPromptResult> {
  const [state, kronos] = await Promise.all([
    fetchWorkerState(),
    fetchJson(KRONOS_URL),
  ]);
  return {
    prompt: assembleDigestPrompt({ state, kronos: kronos ?? {} }),
    fetchedAt: new Date().toISOString(),
    dataAsOf: state.updatedAt,
  };
}
