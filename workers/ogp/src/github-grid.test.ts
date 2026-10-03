import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJogruberContributions, UPSTREAM_TIMEOUT_MS } from "./github-grid";

const VALID_RESPONSE = {
  total: { lastYear: 1 },
  contributions: [
    { date: "2024-01-01", count: 0, level: 0 },
    { date: "2024-01-02", count: 1, level: 1 },
  ],
};

// An upstream that never sends response headers: like the real fetch, it rejects with the signal's reason on abort.
const neverAnswers = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

describe("fetchJogruberContributions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the verbatim payload and the parsed cells on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(VALID_RESPONSE))));

    const result = await fetchJogruberContributions("octocat");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.json).toEqual(VALID_RESPONSE);
    expect(result.text).toBe(JSON.stringify(VALID_RESPONSE));
    expect(result.contributions).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(
      "https://github-contributions-api.jogruber.de/v4/octocat?y=last",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("encodes the username into the upstream path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(VALID_RESPONSE))));

    await fetchJogruberContributions("a b");

    expect(fetch).toHaveBeenCalledWith(
      "https://github-contributions-api.jogruber.de/v4/a%20b?y=last",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports the upstream's own 404 as not-found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));

    await expect(fetchJogruberContributions("nobody")).resolves.toEqual({ status: "not-found" });
  });

  it("reports an upstream that never answers as unavailable once the timeout passes", async () => {
    // #given
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(neverAnswers));

    // #when
    const result = fetchJogruberContributions("octocat");
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);

    // #then
    await expect(result).resolves.toMatchObject({ status: "unavailable" });
  });

  it("keeps waiting for a slow upstream until the timeout", async () => {
    // #given
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(neverAnswers));

    // #when
    const result = fetchJogruberContributions("octocat");
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS - 1);

    // #then
    await expect(Promise.race([result, Promise.resolve("pending")])).resolves.toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    await result;
  });

  it("reports a body that stalls after the headers as unavailable once the timeout passes", async () => {
    // #given
    vi.useFakeTimers();
    // Headers arrive, the body never finishes: like the real fetch, the body stream errors with the signal's reason on abort.
    const stallsMidBody = async (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"contributions":['));
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
          },
        }),
      );
    vi.stubGlobal("fetch", vi.fn(stallsMidBody));

    // #when
    const result = fetchJogruberContributions("octocat");
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);

    // #then
    await expect(result).resolves.toMatchObject({ status: "unavailable" });
  });

  it("reports other non-2xx statuses, network errors, and malformed payloads as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await expect(fetchJogruberContributions("x")).resolves.toMatchObject({ status: "unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(fetchJogruberContributions("x")).resolves.toMatchObject({ status: "unavailable", reason: "network: offline" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ contributions: [{ date: "x" }] }))));
    await expect(fetchJogruberContributions("x")).resolves.toMatchObject({ status: "unavailable" });
  });

  it("refuses bodies over the size limit, by header or by streaming", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(VALID_RESPONSE), { headers: { "content-length": String(64 * 1024 + 1) } })),
    );
    await expect(fetchJogruberContributions("x")).resolves.toMatchObject({ status: "unavailable" });

    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(fetchJogruberContributions("x")).resolves.toMatchObject({ status: "unavailable" });
    expect(cancelled).toBe(true);
  });
});
