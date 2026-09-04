/**
 * Remote MCP server for 草崩し at `kusakuzushi.toshi0607.com/mcp`.
 *
 * Two tools, both read-only from the user's point of view, both proxies over
 * the OGP Worker through a Service Binding (same-zone Workers cannot fetch
 * each other's routes). Nothing is stored: the Durable Object behind
 * `McpAgent` only holds the MCP session itself.
 *
 * Reachable from an MCP client directly (Streamable HTTP, no auth — the data
 * is public and rate-limited upstream), and mirrored into the page's
 * `navigator.modelContext` by `apps/web/src/webmcp/register.ts` so an
 * in-browser agent sees them next to the page's own tools.
 *
 * `McpAgent` is marked feature-frozen in agents 0.22.0 in favour of
 * `createMcpHandler` (stateless, SDK v2). It is used here on purpose: the
 * experiment is the Durable-Object-backed, sessionful flavour that the
 * `registerWebMcp` example pairs with. See tasks/webmcp-article-notes.md.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import { getContributionGrid, renderShareCard } from "./tools";

const SERVER_NAME = "kusakuzushi";
const SERVER_VERSION = "0.1.0";

type Env = {
  MCP_OBJECT: DurableObjectNamespace;
  OGP: Fetcher;
  /** Origins whose pages may call `/mcp` from JavaScript, comma-separated (wrangler.toml `[vars]`; E2E overrides with `--var`). */
  ALLOWED_ORIGINS: string;
  /** Every request to `/mcp`, per client — an `initialize` allocates a Durable Object, so this is the one gate in front of that. */
  MCP_REQUEST_RATE_LIMITER: RateLimit;
};

const MCP_REQUEST_RATE_LIMIT_KEY_PREFIX = "mcp-request";

function allowedOrigins(env: Env): Set<string> {
  // A deploy without the var fails closed (browsers refused, Origin-less clients served).
  return new Set(
    (env.ALLOWED_ORIGINS ?? "").split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

/**
 * `McpAgent.serve` answers every request with `Access-Control-Allow-Origin: *`.
 * That would let any page a visitor loads drive this server from JavaScript
 * (drain the render budget, allocate sessions). Only the site's own page —
 * the bridge — needs cross-origin-free access; non-browser clients (Claude
 * Code) send no Origin and are unaffected. So: refuse browsers from other
 * origins outright, and scope the CORS headers the SDK sets to the one
 * origin that was allowed.
 */
function scopeCors(response: Response, origin: string | null): Response {
  const scoped = new Response(response.body, response);
  if (origin === null) {
    scoped.headers.delete("access-control-allow-origin");
    scoped.headers.delete("access-control-allow-methods");
    scoped.headers.delete("access-control-allow-headers");
    scoped.headers.delete("access-control-expose-headers");
    scoped.headers.delete("access-control-max-age");
  } else {
    scoped.headers.set("access-control-allow-origin", origin);
    scoped.headers.append("vary", "origin");
  }
  return scoped;
}

export class KusakuzushiMcp extends McpAgent<Env> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  async init(): Promise<void> {
    this.server.registerTool(
      "get_contribution_grid",
      {
        title: "GitHub contribution grid",
        description:
          "Fetches a GitHub user's last-year contribution calendar as 草崩し sees it: 53 week strings of daily levels (0-4), " +
          "plus the total and the date range. Public data only.",
        inputSchema: { user: z.string().min(1).max(39).describe("GitHub username (letters, digits, hyphens)") },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async ({ user }) => getContributionGrid(this.env.OGP, { user }),
    );

    this.server.registerTool(
      "render_share_card",
      {
        title: "Render a 草崩し share card",
        description:
          "Renders the OGP share card for a harvest result and returns its image URL, the share link, and a ready-made X post. " +
          "Omit score for a rate-only card (the extension's style). Returns URLs and text, never the image bytes.",
        inputSchema: {
          user: z.string().min(1).max(39).describe("GitHub username (letters, digits, hyphens)"),
          percentage: z.number().int().min(0).max(100).describe("Harvested percentage, 0-100"),
          score: z.number().int().min(0).optional().describe("Score to print on the card; omit to leave the score line out"),
        },
        // The card lands in the edge cache, but nothing a user can see changes.
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async ({ user, percentage, score }) => renderShareCard(this.env.OGP, { user, percentage, score }),
    );
  }
}

const mcpHandler = KusakuzushiMcp.serve("/mcp", { binding: "MCP_OBJECT" });

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

    // Streamable HTTP is POST (messages) and DELETE (end of session). GET would
    // open a server-initiated stream that pins the Durable Object for the life
    // of the connection; nothing here needs it (the page bridge runs with
    // `watch: false`), so it is refused rather than left open.
    if (request.method !== "POST" && request.method !== "DELETE" && request.method !== "OPTIONS") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, DELETE, OPTIONS" } });
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

    // `McpAgent.serve("/mcp")` matches its path exactly, so the trailing-slash
    // spelling is folded into the canonical one before delegating.
    let delegated = request;
    if (url.pathname === "/mcp/") {
      url.pathname = "/mcp";
      delegated = new Request(url.toString(), request);
    }
    return scopeCors(await mcpHandler.fetch(delegated, env, ctx), origin);
  },
};
