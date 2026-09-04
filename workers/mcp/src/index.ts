/**
 * Remote MCP server for 草崩し at `kusakuzushi.toshi0607.com/mcp`.
 *
 * Two tools, both read-only from the user's point of view, both proxies over
 * the OGP Worker through a Service Binding (same-zone Workers cannot fetch
 * each other's routes). Nothing is stored anywhere.
 *
 * Served **stateless** (`createMcpHandler` + an SDK v2 factory): every
 * request is answered by a fresh server, `tools/list` works without an
 * `initialize`, and there is no session to hold. That is the shape the
 * Agents SDK now recommends (`McpAgent` is feature-frozen) and, decisively,
 * the shape Cloudflare's zero-code WebMCP injection expects: its bridge
 * posts `tools/list` first, with no session, and a sessionful server answers
 * 400. The first deployment used `McpAgent`; tasks/webmcp-article-notes.md
 * records what changed and why.
 *
 * Reachable from an MCP client directly (Streamable HTTP, no auth — the data
 * is public and rate-limited upstream), from the page's own bridge
 * (`apps/web/src/webmcp/register.ts`, same origin), and from the injected
 * bridge when the zone toggle is on.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { getContributionGrid, renderShareCard } from "./tools";

const SERVER_NAME = "kusakuzushi";
const SERVER_VERSION = "0.2.0";

type Env = {
  OGP: Fetcher;
  /** Origins whose pages may call `/mcp` from JavaScript, comma-separated (wrangler.toml `[vars]`; .dev.vars locally). */
  ALLOWED_ORIGINS: string;
  /** Every request to `/mcp`, per client. */
  MCP_REQUEST_RATE_LIMITER: RateLimit;
};

const MCP_REQUEST_RATE_LIMIT_KEY_PREFIX = "mcp-request";

function buildServer(ogp: Fetcher): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const user = z.string().min(1).max(39).describe("GitHub username (letters, digits, hyphens)");

  server.registerTool(
    "get_contribution_grid",
    {
      title: "GitHub contribution grid",
      description:
        "Fetches a GitHub user's last-year contribution calendar as 草崩し sees it: 53 week strings of daily levels (0-4), " +
        "plus the total and the date range. Public data only.",
      inputSchema: z.object({ user }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => getContributionGrid(ogp, input),
  );

  server.registerTool(
    "render_share_card",
    {
      title: "Render a 草崩し share card",
      description:
        "Renders the OGP share card for a harvest result and returns its image URL, the share link, and a ready-made X post. " +
        "Omit score for a rate-only card (the extension's style). Returns URLs and text, never the image bytes.",
      inputSchema: z.object({
        user,
        percentage: z.number().int().min(0).max(100).describe("Harvested percentage, 0-100"),
        score: z.number().int().min(0).optional().describe("Score to print on the card; omit to leave the score line out"),
      }),
      // The card lands in the edge cache, but nothing a user can see changes.
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => renderShareCard(ogp, input),
  );

  return server;
}

// Bindings are the same for every request an isolate serves, so the handler
// (and the Service Binding the tools close over) is built once per isolate.
let handler: ReturnType<typeof createMcpHandler> | null = null;

function mcpHandler(env: Env): ReturnType<typeof createMcpHandler> {
  handler ??= createMcpHandler(() => buildServer(env.OGP), {
    route: "/mcp",
    // The wrapper below owns Origin policy; the handler adds no CORS headers
    // and trusts that upstream check ("*" is documented for exactly this).
    corsOptions: false,
    allowedOriginHostnames: "*",
    legacy: "stateless",
  });
  return handler;
}

function allowedOrigins(env: Env): Set<string> {
  // A deploy without the var fails closed (browsers refused, Origin-less clients served).
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

/**
 * Browsers from other origins are refused outright; the page bridge is
 * same-origin and needs no CORS, and non-browser clients (Claude Code) send
 * no Origin. An allowed origin gets a scoped header rather than `*`.
 */
function scopeCors(response: Response, origin: string | null): Response {
  if (origin === null) {
    return response;
  }
  const scoped = new Response(response.body, response);
  scoped.headers.set("access-control-allow-origin", origin);
  scoped.headers.set("access-control-expose-headers", "mcp-session-id, mcp-protocol-version");
  scoped.headers.append("vary", "origin");
  return scoped;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Some clients normalise the endpoint to a trailing slash; both spell the same server.
    if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") {
      return new Response("Not Found", { status: 404 });
    }

    const origin = request.headers.get("origin");
    if (origin !== null && !allowedOrigins(env).has(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Stateless serving has no session to stream on: POST (messages) and
    // OPTIONS (preflight for an allowed origin) are all there is.
    if (request.method !== "POST" && request.method !== "OPTIONS") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }
    if (request.method === "OPTIONS") {
      return scopeCors(
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version",
            "access-control-max-age": "86400",
          },
        }),
        origin,
      );
    }

    let admitted: boolean;
    try {
      const key = `${MCP_REQUEST_RATE_LIMIT_KEY_PREFIX}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
      admitted = (await env.MCP_REQUEST_RATE_LIMITER.limit({ key })).success;
    } catch (error) {
      console.error("mcp request admission failed", error);
      return new Response("Service Unavailable", { status: 503, headers: { "cache-control": "no-store" } });
    }
    if (!admitted) {
      return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
    }

    let delegated = request;
    if (url.pathname === "/mcp/") {
      url.pathname = "/mcp";
      delegated = new Request(url.toString(), request);
    }
    return scopeCors(await mcpHandler(env)(delegated, env, ctx), origin);
  },
};
