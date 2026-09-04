/**
 * The server-side half of 草崩し, on two routes of the same zone:
 *
 * - `/share/{user}`: crawlers get OGP-tagged HTML (whose image reflects the
 *   score/percentage carried in the `s`/`p` query params), human visitors get
 *   redirected to the app. `/share/{user}/og.png` renders the actual card
 *   image, cached via the Cache API since rendering is expensive.
 * - `/api/grid/{user}`: the contribution calendar the web app plays on,
 *   proxied from the jogruber API (`github-grid.ts`) so the page only ever
 *   talks to its own origin and the upstream can be swapped server-side.
 *
 * The MCP Worker (`workers/mcp`) reaches both through a Service Binding —
 * same-zone Workers cannot `fetch` each other's routes — and marks its
 * requests with `x-kusakuzushi-via: mcp` so agent traffic is throttled
 * separately, before it can drain the render budget real crawlers share.
 */

import { isCrawlerUserAgent } from "./crawler";
import { isValidGithubUsername, parseShareParams } from "./share-params";
import { buildOgpHtml } from "./ogp-page";
import { renderOgImage, type OgImageRender } from "./og-image";
import { fetchJogruberContributions } from "./github-grid";

const SITE_URL = "https://kusakuzushi.toshi0607.com";
const SHARE_PAGE_PATTERN = /^\/share\/([^/]+)$/;
const OG_IMAGE_PATTERN = /^\/share\/([^/]+)\/og\.png$/;
const GRID_API_PATTERN = /^\/api\/grid\/([^/]+)$/;
const OGP_RENDER_RATE_LIMIT_KEY = "ogp-render-cache-miss";
const MCP_RENDER_RATE_LIMIT_KEY_PREFIX = "ogp-render-via-mcp";
const GRID_FETCH_RATE_LIMIT_KEY_PREFIX = "grid-fetch-cache-miss";
/** Set by workers/mcp on its Service Binding requests. Anyone can send it — it only buys a stricter limit. */
const VIA_HEADER = "x-kusakuzushi-via";
const VIA_MCP = "mcp";
/**
 * Names the calendar's total on the card response so the MCP Worker can
 * write the scored post without a second grid fetch (workers/mcp/src/tools.ts).
 */
const TOTAL_HEADER = "x-kusakuzushi-total";
/** How long a fetched calendar is served from the edge before jogruber is asked again. */
const GRID_MAX_AGE_SECONDS = 600;
type Env = {
  OGP_RENDER_RATE_LIMITER: RateLimit;
  MCP_RENDER_RATE_LIMITER: RateLimit;
  GRID_FETCH_RATE_LIMITER: RateLimit;
};
type InFlightRender = {
  render: Promise<OgImageRender>;
  cacheWrite: Promise<void>;
};
const inFlightRenders = new Map<string, InFlightRender>();
const pendingRenderAdmissions = new Map<string, Promise<InFlightRender | null>>();
/** Concurrent misses for one user share one upstream fetch (and one limiter token). */
const inFlightGrids = new Map<string, Promise<Response>>();

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function methodNotAllowed(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: "GET, HEAD" },
  });
}

function tooManyRequests(): Response {
  return new Response("Too Many Requests", {
    status: 429,
    headers: {
      "retry-after": "60",
      "cache-control": "no-store",
    },
  });
}

function serviceUnavailable(what: string): Response {
  return new Response(`${what} temporarily unavailable`, {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

function isViaMcp(request: Request): boolean {
  return request.headers.get(VIA_HEADER) === VIA_MCP;
}

/**
 * Rate-limit buckets are per client, not one for the world: a single
 * caller looping over names must not be able to lock everyone else out
 * (before the grid moved behind this route, each browser paid for its own
 * jogruber calls). Eyeball requests carry `cf-connecting-ip`; a Service
 * Binding request (the MCP Worker) carries none and shares one bucket, so
 * a public caller spoofing the via header only ever spends its own.
 */
function clientKey(request: Request, prefix: string): string {
  return `${prefix}:${request.headers.get("cf-connecting-ip") ?? "service-binding"}`;
}

function createGridCacheKey(request: Request, user: string): Request {
  const url = new URL(request.url);
  // GitHub usernames are case-insensitive and jogruber's payload does not
  // echo the name, so one entry serves every casing.
  url.pathname = `/api/grid/${encodeURIComponent(user.toLowerCase())}`;
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

/**
 * `/api/grid/{user}`: the validated jogruber payload, verbatim. Validation
 * runs here (a malformed upstream body becomes a 502, never a cached 200),
 * and the web app validates again on its side — two bundles, two guards.
 */
async function handleGridApi(request: Request, user: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  // The name is rejected before it reaches the upstream URL or any response
  // body; nothing about an invalid name is echoed back.
  if (!isValidGithubUsername(user)) {
    return notFound();
  }

  const cache = caches.default;
  const cacheKey = createGridCacheKey(request, user);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // Registered synchronously on the miss path, before any await, so two
  // requests that both missed the cache share one admission and one fetch.
  let pending = inFlightGrids.get(cacheKey.url);
  if (!pending) {
    pending = admitAndFetchGrid(request, user, env);
    inFlightGrids.set(cacheKey.url, pending);
    const remove = () => {
      if (inFlightGrids.get(cacheKey.url) === pending) {
        inFlightGrids.delete(cacheKey.url);
      }
    };
    void pending.then(remove, remove);
  }

  const response = (await pending).clone();
  // Both the calendar and "no such user" are cached: a name that does not
  // exist costs the upstream (and this client's budget) once per window,
  // not once per request.
  if (response.status === 200 || response.status === 404) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

async function admitAndFetchGrid(request: Request, user: string, env: Env): Promise<Response> {
  let admitted: boolean;
  try {
    admitted = (await env.GRID_FETCH_RATE_LIMITER.limit({ key: clientKey(request, GRID_FETCH_RATE_LIMIT_KEY_PREFIX) })).success;
  } catch (error) {
    // Fail closed, as the render path does: a broken binding must not turn
    // every miss into an unbounded upstream fetch.
    console.error("grid fetch admission failed", error);
    return serviceUnavailable("contribution data");
  }
  if (!admitted) {
    return tooManyRequests();
  }
  return fetchGridResponse(user);
}

async function fetchGridResponse(user: string): Promise<Response> {
  const result = await fetchJogruberContributions(user);
  if (result.status === "not-found") {
    return new Response("Not Found", {
      status: 404,
      headers: { "cache-control": `public, max-age=${GRID_MAX_AGE_SECONDS}, s-maxage=${GRID_MAX_AGE_SECONDS}` },
    });
  }
  if (result.status === "unavailable") {
    console.error("grid fetch failed", result.reason);
    return new Response("Bad Gateway", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response(result.text, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${GRID_MAX_AGE_SECONDS}, s-maxage=${GRID_MAX_AGE_SECONDS}`,
    },
  });
}

function createOgImageCacheKey(request: Request, user: string, score: number | null, percentage: number): Request {
  const url = new URL(request.url);
  url.pathname = `/share/${encodeURIComponent(user.toLowerCase())}/og.png`;
  const searchParams = new URLSearchParams();
  if (score !== null) {
    searchParams.set("s", String(score));
  }
  searchParams.set("p", String(percentage));
  url.search = searchParams.toString();
  return new Request(url.toString(), { method: "GET" });
}

function createOgImageResponse(render: OgImageRender): Response {
  const maxAge = render.gridIncluded ? 86400 : 300;
  const headers: Record<string, string> = {
    "content-type": "image/png",
    "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
  };
  if (render.total !== null) {
    headers[TOTAL_HEADER] = String(render.total);
  }
  return new Response(render.response.clone().body, { status: 200, headers });
}

function createInFlightRender(
  cache: Cache,
  cacheKey: Request,
  user: string,
  score: number | null,
  percentage: number,
): InFlightRender {
  const render = renderOgImage(user, score, percentage);
  const cacheWrite = render.then((result) => cache.put(cacheKey, createOgImageResponse(result)));
  const entry = { render, cacheWrite };
  inFlightRenders.set(cacheKey.url, entry);
  const removeEntry = () => {
    if (inFlightRenders.get(cacheKey.url) === entry) {
      inFlightRenders.delete(cacheKey.url);
    }
  };
  void cacheWrite.then(removeEntry, removeEntry);
  return entry;
}

async function admitRender(
  cache: Cache,
  cacheKey: Request,
  user: string,
  score: number | null,
  percentage: number,
  limiter: RateLimit,
): Promise<InFlightRender | null> {
  const outcome = await limiter.limit({ key: OGP_RENDER_RATE_LIMIT_KEY });
  if (!outcome.success) {
    return null;
  }

  const joined = inFlightRenders.get(cacheKey.url);
  if (joined) {
    return joined;
  }

  return createInFlightRender(cache, cacheKey, user, score, percentage);
}

function getOrCreateInFlightRender(
  cache: Cache,
  cacheKey: Request,
  user: string,
  score: number | null,
  percentage: number,
  limiter: RateLimit,
): Promise<InFlightRender | null> {
  const existing = inFlightRenders.get(cacheKey.url);
  if (existing) {
    return Promise.resolve(existing);
  }

  const pending = pendingRenderAdmissions.get(cacheKey.url);
  if (pending) {
    return pending;
  }

  const admission = admitRender(cache, cacheKey, user, score, percentage, limiter).catch((error) => {
    // Fail closed so a persistent missing/broken binding cannot turn every
    // cache miss into an unbounded render workload.
    console.error("OG image render admission failed", error);
    throw error;
  });
  pendingRenderAdmissions.set(cacheKey.url, admission);
  const removeAdmission = () => {
    if (pendingRenderAdmissions.get(cacheKey.url) === admission) {
      pendingRenderAdmissions.delete(cacheKey.url);
    }
  };
  void admission.then(removeAdmission, removeAdmission);
  return admission;
}

function handleSharePage(request: Request, user: string, searchParams: URLSearchParams): Response {
  const params = parseShareParams(user, searchParams);
  if (!params) {
    return notFound();
  }

  if (!isCrawlerUserAgent(request.headers.get("user-agent"))) {
    return Response.redirect(`${SITE_URL}/?user=${encodeURIComponent(params.user)}`, 302);
  }

  return new Response(buildOgpHtml(params.user, params.score, params.percentage), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
      // The same URL serves a 302 to non-crawlers — keep shared caches from
      // handing the crawler HTML to humans.
      vary: "user-agent",
    },
  });
}

async function handleOgImage(
  request: Request,
  user: string,
  searchParams: URLSearchParams,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const params = parseShareParams(user, searchParams);
  if (!params) {
    return notFound();
  }

  const cache = caches.default;
  const cacheKey = createOgImageCacheKey(request, params.user, params.score, params.percentage);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // Agent-driven renders get their own, smaller budget ahead of the shared
  // one: an agent varying score/percentage in a loop must not leave real
  // crawlers (X, Slack) with 429s on genuine shares. Cache hits above are
  // free for everyone.
  if (isViaMcp(request)) {
    let admitted: boolean;
    try {
      admitted = (await env.MCP_RENDER_RATE_LIMITER.limit({ key: clientKey(request, MCP_RENDER_RATE_LIMIT_KEY_PREFIX) })).success;
    } catch (error) {
      console.error("OG image mcp admission failed", error);
      return serviceUnavailable("og image generation");
    }
    if (!admitted) {
      return tooManyRequests();
    }
  }

  let inFlight: InFlightRender | null;
  try {
    inFlight = await getOrCreateInFlightRender(
      cache,
      cacheKey,
      params.user,
      params.score,
      params.percentage,
      env.OGP_RENDER_RATE_LIMITER,
    );
  } catch {
    return serviceUnavailable("og image generation");
  }
  if (!inFlight) {
    return tooManyRequests();
  }

  // Font loading or the satori render itself can fail on an external outage —
  // return a controlled, uncached 500 instead of an unhandled Worker exception.
  let render: OgImageRender;
  try {
    render = await inFlight.render;
  } catch {
    return new Response("og image generation failed", {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }

  // A grid-less fallback card (jogruber outage) is cached briefly so the full
  // card replaces it soon after recovery.
  ctx.waitUntil(inFlight.cacheWrite);
  return createOgImageResponse(render);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const imageMatch = url.pathname.match(OG_IMAGE_PATTERN);
    if (imageMatch) {
      return handleOgImage(request, imageMatch[1], url.searchParams, env, ctx);
    }

    const shareMatch = url.pathname.match(SHARE_PAGE_PATTERN);
    if (shareMatch) {
      return handleSharePage(request, shareMatch[1], url.searchParams);
    }

    const gridMatch = url.pathname.match(GRID_API_PATTERN);
    if (gridMatch) {
      return handleGridApi(request, gridMatch[1], env, ctx);
    }

    return notFound();
  },
};
