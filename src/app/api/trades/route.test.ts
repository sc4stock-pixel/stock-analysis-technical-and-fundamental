import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("/api/trades GET", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "tok";
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns parsed trade_log array", async () => {
    const arr = [{ id: "X|2026-01-01|entry", ticker: "X" }];
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: JSON.stringify(arr) }), { status: 200 })));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(arr);
  });

  it("strips bare NaN before parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: '[{"id":"a","signal_price":NaN}]' }), { status: 200 })));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "a", signal_price: null }]);
  });

  it("returns [] when key empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: null }), { status: 200 })));
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual([]);
  });

  it("503 when KV not configured", async () => {
    delete process.env.KV_REST_API_URL;
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(503);
  });
});
