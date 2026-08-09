import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderOgImageMock } = vi.hoisted(() => ({
  renderOgImageMock: vi.fn(),
}));

vi.mock("./og-image", () => ({
  renderOgImage: renderOgImageMock,
}));

import worker from "./index";

type WaitContext = {
  ctx: ExecutionContext;
  settled: () => Promise<void>;
};

type WorkerEnv = {
  OGP_RENDER_RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
};

function createContext(): WaitContext {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as ExecutionContext,
    settled: () => Promise.all(pending).then(() => undefined),
  };
}

function createRenderResult(gridIncluded = true) {
  return {
    response: new Response("png"),
    gridIncluded,
  };
}

describe("OG image route", () => {
  let cache: Cache;
  let cacheMatch: ReturnType<typeof vi.fn>;
  let cachePut: ReturnType<typeof vi.fn>;
  let rateLimit: ReturnType<typeof vi.fn>;
  let env: WorkerEnv;

  beforeEach(() => {
    const entries = new Map<string, Response>();
    cacheMatch = vi.fn(async (request: Request) => entries.get(request.url)?.clone());
    cachePut = vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    });
    cache = {
      match: cacheMatch,
      put: cachePut,
    } as unknown as Cache;
    rateLimit = vi.fn(async () => ({ success: true }));
    env = {
      OGP_RENDER_RATE_LIMITER: {
        limit: rateLimit as WorkerEnv["OGP_RENDER_RATE_LIMITER"]["limit"],
      },
    };
    vi.stubGlobal("caches", { default: cache });
    renderOgImageMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders and caches a legitimate GET image for 24 hours", async () => {
    // #given
    renderOgImageMock.mockResolvedValue(createRenderResult());
    const { ctx, settled } = createContext();

    // #when
    const response = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=12340&p=87"),
      env,
      ctx,
    );
    await settled();

    // #then
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
    expect(await response.text()).toBe("png");
    expect(renderOgImageMock).toHaveBeenCalledWith("toshi0607", 12340, 87);
    expect(rateLimit).toHaveBeenCalledWith({ key: "ogp-render-cache-miss" });
    expect(cachePut).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/share/toshi0607/og.png?s=12340&p=87" }),
      expect.any(Response),
    );
  });

  it("caches a grid-less fallback GET image for five minutes", async () => {
    // #given
    renderOgImageMock.mockResolvedValue(createRenderResult(false));
    const { ctx, settled } = createContext();

    // #when
    const response = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=12340&p=87"),
      env,
      ctx,
    );
    await settled();

    // #then
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
  });

  it("bypasses the rate limiter for canonical cache hits", async () => {
    // #given
    renderOgImageMock.mockResolvedValue(createRenderResult());
    const miss = createContext();
    await worker.fetch(new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"), env, miss.ctx);
    await miss.settled();
    const hit = createContext();

    // #when
    const response = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?p=50&s=001&ignored=true"),
      env,
      hit.ctx,
    );

    // #then
    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(renderOgImageMock).toHaveBeenCalledTimes(1);
  });

  it("shares a denied same-key admission without rendering or caching", async () => {
    // #given
    rateLimit.mockResolvedValue({ success: false });
    const first = createContext();
    const second = createContext();

    // #when
    const [firstResponse, secondResponse] = await Promise.all([
      worker.fetch(
        new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
        env,
        first.ctx,
      ),
      worker.fetch(
        new Request("https://example.com/share/toshi0607/og.png?p=50&s=001&ignored=true"),
        env,
        second.ctx,
      ),
    ]);

    // #then
    expect(firstResponse.status).toBe(429);
    expect(secondResponse.status).toBe(429);
    expect(firstResponse.headers.get("retry-after")).toBe("60");
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(rateLimit).toHaveBeenCalledWith({ key: "ogp-render-cache-miss" });
    expect(renderOgImageMock).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it("fails closed when a shared limiter admission rejects, then admits a later miss", async () => {
    // #given
    const failure = new Error("missing rate limiter binding");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rateLimit.mockRejectedValueOnce(failure);
    const first = createContext();
    const second = createContext();

    try {
      // #when: same-key requests share the rejected admission.
      const [firstResponse, secondResponse] = await Promise.all([
        worker.fetch(
          new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
          env,
          first.ctx,
        ),
        worker.fetch(
          new Request("https://example.com/share/toshi0607/og.png?p=50&s=001"),
          env,
          second.ctx,
        ),
      ]);

      // #then
      expect(firstResponse.status).toBe(503);
      expect(secondResponse.status).toBe(503);
      expect(firstResponse.headers.get("cache-control")).toBe("no-store");
      expect(rateLimit).toHaveBeenCalledTimes(1);
      expect(renderOgImageMock).not.toHaveBeenCalled();
      expect(cachePut).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("OG image render admission failed", failure);

      // #when: rejection cleanup allows a fresh later admission.
      renderOgImageMock.mockResolvedValue(createRenderResult());
      const retry = createContext();
      const retryResponse = await worker.fetch(
        new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
        env,
        retry.ctx,
      );
      await retry.settled();

      // #then
      expect(retryResponse.status).toBe(200);
      expect(rateLimit).toHaveBeenCalledTimes(2);
      expect(renderOgImageMock).toHaveBeenCalledTimes(1);
      expect(cachePut).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("uses distinct canonical entries for scored, scoreless, and explicit-zero links", async () => {
    // #given
    renderOgImageMock.mockImplementation(async () => createRenderResult());
    const equivalentScoreAndPercentage = [
      "https://example.com/share/toshi0607/og.png?ignored=true&p=50&s=001&s=999",
      "https://example.com/share/toshi0607/og.png?s=1&p=50",
      "https://example.com/share/toshi0607/og.png?p=50&unused=true&s=1",
    ];
    const equivalentScorelessValues = [
      "https://example.com/share/toshi0607/og.png?s=not-a-number&p=50&unused=true",
      "https://example.com/share/toshi0607/og.png?another=ignored&p=50",
    ];
    const explicitZero = "https://example.com/share/toshi0607/og.png?s=0&p=50";

    // #when
    for (const url of [...equivalentScoreAndPercentage, ...equivalentScorelessValues, explicitZero]) {
      const { ctx, settled } = createContext();
      await worker.fetch(new Request(url), env, ctx);
      await settled();
    }

    // #then
    expect(renderOgImageMock).toHaveBeenCalledTimes(3);
    expect(cacheMatch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/share/toshi0607/og.png?s=1&p=50" }),
    );
    expect(cacheMatch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/share/toshi0607/og.png?p=50" }),
    );
    expect(cacheMatch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/share/toshi0607/og.png?s=0&p=50" }),
    );
    expect(renderOgImageMock).toHaveBeenCalledWith("toshi0607", null, 50);
    expect(renderOgImageMock).toHaveBeenCalledWith("toshi0607", 0, 50);
  });

  it("shares one render promise across concurrent misses for the same canonical key", async () => {
    // #given
    let resolveRender: ((value: ReturnType<typeof createRenderResult>) => void) | undefined;
    renderOgImageMock.mockImplementation(
      () => new Promise<ReturnType<typeof createRenderResult>>((resolve) => {
        resolveRender = resolve;
      }),
    );
    const first = createContext();
    const second = createContext();

    // #when
    const firstResponse = worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=1&p=50&ignored=true"),
      env,
      first.ctx,
    );
    const secondResponse = worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?p=50&s=001"),
      env,
      second.ctx,
    );
    await vi.waitFor(() => expect(renderOgImageMock).toHaveBeenCalledTimes(1));
    resolveRender?.(createRenderResult());
    const [firstResult, secondResult] = await Promise.all([firstResponse, secondResponse]);
    await Promise.all([first.settled(), second.settled()]);

    // #then
    expect(firstResult.status).toBe(200);
    expect(secondResult.status).toBe(200);
    expect(await firstResult.text()).toBe("png");
    expect(await secondResult.text()).toBe("png");
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });

  it("canonicalizes username casing for cache and singleflight while rendering the original casing", async () => {
    // #given
    let resolveRender: ((value: ReturnType<typeof createRenderResult>) => void) | undefined;
    renderOgImageMock.mockImplementation(
      () => new Promise<ReturnType<typeof createRenderResult>>((resolve) => {
        resolveRender = resolve;
      }),
    );
    const first = createContext();
    const second = createContext();

    // #when
    const firstResponse = worker.fetch(
      new Request("https://example.com/share/ToShi0607/og.png?s=1&p=50"),
      env,
      first.ctx,
    );
    const secondResponse = worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
      env,
      second.ctx,
    );
    await vi.waitFor(() => expect(renderOgImageMock).toHaveBeenCalledTimes(1));
    resolveRender?.(createRenderResult());
    await Promise.all([firstResponse, secondResponse]);
    await Promise.all([first.settled(), second.settled()]);
    const cacheHit = createContext();
    const cacheHitResponse = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
      env,
      cacheHit.ctx,
    );

    // #then
    expect(cacheHitResponse.status).toBe(200);
    expect(renderOgImageMock).toHaveBeenCalledTimes(1);
    expect(renderOgImageMock).toHaveBeenCalledWith("ToShi0607", 1, 50);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/share/toshi0607/og.png?s=1&p=50" }),
      expect.any(Response),
    );
  });

  it("singleflights same-key limiter admission before creating a render", async () => {
    // #given
    const resolveLimits: (() => void)[] = [];
    rateLimit.mockImplementation(
      () => new Promise<{ success: boolean }>((resolve) => {
        resolveLimits.push(() => resolve({ success: true }));
      }),
    );
    renderOgImageMock.mockResolvedValue(createRenderResult());
    const first = createContext();
    const second = createContext();

    // #when
    const firstResponse = worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
      env,
      first.ctx,
    );
    const secondResponse = worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
      env,
      second.ctx,
    );
    await vi.waitFor(() => expect(rateLimit).toHaveBeenCalledTimes(1));
    resolveLimits.forEach((resolve) => resolve());
    await Promise.all([firstResponse, secondResponse]);
    await Promise.all([first.settled(), second.settled()]);

    // #then
    expect(renderOgImageMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the render shared until its canonical cache write settles", async () => {
    // #given
    const resolveCachePuts: (() => void)[] = [];
    cachePut.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveCachePuts.push(resolve);
      }),
    );
    renderOgImageMock.mockResolvedValue(createRenderResult());
    const first = createContext();

    // #when: the render has completed, but its cache write remains pending.
    const firstResult = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"),
      env,
      first.ctx,
    );
    await vi.waitFor(() => expect(cachePut).toHaveBeenCalledTimes(1));
    const third = createContext();
    const thirdResult = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?p=50&s=001&ignored=true"),
      env,
      third.ctx,
    );
    resolveCachePuts.forEach((resolve) => resolve());
    await first.settled();

    // #then
    expect(firstResult.status).toBe(200);
    expect(thirdResult.status).toBe(200);
    expect(renderOgImageMock).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledTimes(1);
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });

  it("serves HEAD from the canonical GET cache entry", async () => {
    // #given
    renderOgImageMock.mockResolvedValue(createRenderResult());
    const get = createContext();
    await worker.fetch(new Request("https://example.com/share/toshi0607/og.png?s=1&p=50"), env, get.ctx);
    await get.settled();
    const head = createContext();

    // #when
    const response = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?p=50&s=001&ignored=true", { method: "HEAD" }),
      env,
      head.ctx,
    );

    // #then
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(renderOgImageMock).toHaveBeenCalledTimes(1);
    expect(cacheMatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "https://example.com/share/toshi0607/og.png?s=1&p=50" }),
    );
  });

  it("does not render or cache unsupported methods", async () => {
    // #given
    const { ctx } = createContext();

    // #when
    const response = await worker.fetch(
      new Request("https://example.com/share/toshi0607/og.png?s=12340&p=87", { method: "POST" }),
      env,
      ctx,
    );

    // #then
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(renderOgImageMock).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
  });

  it("returns 404 for invalid image users without rendering", async () => {
    // #given
    const { ctx } = createContext();

    // #when
    const response = await worker.fetch(new Request("https://example.com/share/not_valid/og.png"), env, ctx);

    // #then
    expect(response.status).toBe(404);
    expect(renderOgImageMock).not.toHaveBeenCalled();
    expect(cacheMatch).not.toHaveBeenCalled();
  });

  it("keeps share-page responses separate from the image renderer", async () => {
    // #given
    const { ctx } = createContext();

    // #when
    const response = await worker.fetch(new Request("https://example.com/share/toshi0607?s=1&p=50"), env, ctx);

    // #then
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://kusakuzushi.toshi0607.com/?user=toshi0607");
    expect(renderOgImageMock).not.toHaveBeenCalled();
  });

  it("continues to serve crawler share pages without rendering an image", async () => {
    // #given
    const { ctx } = createContext();

    // #when
    const response = await worker.fetch(
      new Request("https://example.com/share/toshi0607?s=1&p=50", {
        headers: { "user-agent": "Twitterbot" },
      }),
      env,
      ctx,
    );

    // #then
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("vary")).toBe("user-agent");
    expect(renderOgImageMock).not.toHaveBeenCalled();
  });
});
