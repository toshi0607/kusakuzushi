/**
 * OGP Worker for `/share/{user}`: crawlers get OGP-tagged HTML (whose image
 * reflects the score/percentage carried in the `s`/`p` query params), human
 * visitors get redirected to the app. `/share/{user}/og.png` renders the
 * actual card image, cached via the Cache API since rendering is expensive.
 */

import { isCrawlerUserAgent } from "./crawler";
import { parseShareParams } from "./share-params";
import { buildOgpHtml } from "./ogp-page";
import { renderOgImage, type OgImageRender } from "./og-image";

const SITE_URL = "https://kusakuzushi.toshi0607.com";
const SHARE_PAGE_PATTERN = /^\/share\/([^/]+)$/;
const OG_IMAGE_PATTERN = /^\/share\/([^/]+)\/og\.png$/;
const OGP_RENDER_RATE_LIMIT_KEY = "ogp-render-cache-miss";
type Env = {
  OGP_RENDER_RATE_LIMITER: RateLimit;
};
type InFlightRender = {
  render: Promise<OgImageRender>;
  cacheWrite: Promise<void>;
};
const inFlightRenders = new Map<string, InFlightRender>();
const pendingRenderAdmissions = new Map<string, Promise<InFlightRender | null>>();

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

function createOgImageCacheKey(request: Request, user: string, score: number | null, percentage: number): Request {
  const url = new URL(request.url);
  url.pathname = `/share/${encodeURIComponent(user)}/og.png`;
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
  return new Response(render.response.clone().body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });
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

  const admission = admitRender(cache, cacheKey, user, score, percentage, limiter);
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

  // Font loading or the satori render itself can fail on an external outage —
  // return a controlled, uncached 500 instead of an unhandled Worker exception.
  const inFlight = await getOrCreateInFlightRender(
    cache,
    cacheKey,
    params.user,
    params.score,
    params.percentage,
    env.OGP_RENDER_RATE_LIMITER,
  );
  if (!inFlight) {
    return tooManyRequests();
  }

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

    return notFound();
  },
};
