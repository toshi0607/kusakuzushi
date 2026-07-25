/**
 * OGP Worker for `/share/{user}`: crawlers get OGP-tagged HTML (whose image
 * reflects the score/percentage carried in the `s`/`p` query params), human
 * visitors get redirected to the app. `/share/{user}/og.png` renders the
 * actual card image, cached via the Cache API since rendering is expensive.
 */

import { isCrawlerUserAgent } from "./crawler";
import { parseShareParams } from "./share-params";
import { buildOgpHtml } from "./ogp-page";
import { renderOgImage } from "./og-image";

const SITE_URL = "https://kusakuzushi.toshi0607.com";
const SHARE_PAGE_PATTERN = /^\/share\/([^/]+)$/;
const OG_IMAGE_PATTERN = /^\/share\/([^/]+)\/og\.png$/;

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
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
  ctx: ExecutionContext,
): Promise<Response> {
  const params = parseShareParams(user, searchParams);
  if (!params) {
    return notFound();
  }

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  // Font loading or the satori render itself can fail on an external outage —
  // return a controlled, uncached 500 instead of an unhandled Worker exception.
  let render;
  try {
    render = await renderOgImage(params.user, params.score, params.percentage);
  } catch {
    return new Response("og image generation failed", {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }

  // A grid-less fallback card (jogruber outage) is cached briefly so the full
  // card replaces it soon after recovery.
  const maxAge = render.gridIncluded ? 86400 : 300;
  const response = new Response(render.response.body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });

  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const imageMatch = url.pathname.match(OG_IMAGE_PATTERN);
    if (imageMatch) {
      return handleOgImage(request, imageMatch[1], url.searchParams, ctx);
    }

    const shareMatch = url.pathname.match(SHARE_PAGE_PATTERN);
    if (shareMatch) {
      return handleSharePage(request, shareMatch[1], url.searchParams);
    }

    return notFound();
  },
};
