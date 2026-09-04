/**
 * Registers the page's tools on `navigator.modelContext` and mirrors the
 * remote MCP server's tools (workers/mcp, same origin at `/mcp`) in beside
 * them through Cloudflare's WebMCP adapter.
 *
 * Loaded only when the browser has a native `navigator.modelContext`
 * (main.ts gates the import): without one the adapter is a documented
 * no-op, and the adapter alone is ~90 KB gzipped of MCP client — far more
 * than this page's whole script budget (lighthouserc.cjs).
 *
 * The adapter is experimental and pinned exactly (apps/web/package.json);
 * it reads `navigator.modelContext`, not the spec's `document.modelContext`,
 * so it stops working the day Chrome drops that alias. See
 * tasks/webmcp-article-notes.md.
 */

import { registerWebMcp } from "agents/experimental/webmcp";

import type { AppController } from "../app";
import { createPageTools } from "./tools";

/** Remote tools show up as `remote.<name>` so they can never shadow a page tool (collisions are silent). */
export const REMOTE_TOOL_PREFIX = "remote.";
/** Per-request cap for `tools/list` and `tools/call` — a cold card render can take a few seconds. */
const REMOTE_TIMEOUT_MS = 20_000;

export async function registerWebMcpTools(controller: AppController, signal: AbortSignal): Promise<void> {
  const context = navigator.modelContext;
  if (!context) {
    return;
  }

  // Page tools first: they are the ones an agent should find even when the
  // Worker is unreachable, and the spec has no unregister call — a tool goes
  // away only with the signal it was registered under.
  for (const tool of createPageTools(controller)) {
    if (signal.aborted) return;
    context.registerTool(tool, { signal });
  }

  try {
    const remote = await registerWebMcp({
      url: "/mcp",
      prefix: REMOTE_TOOL_PREFIX,
      // The tool list is static; watching would hold a GET stream (and a
      // Durable Object) open for every tab for nothing.
      watch: false,
      timeoutMs: REMOTE_TIMEOUT_MS,
      quiet: true,
    });
    if (signal.aborted) {
      await remote.dispose();
      return;
    }
    signal.addEventListener("abort", () => void remote.dispose(), { once: true });
  } catch (error) {
    // The page tools stay; only the Worker's are missing. Nothing else on
    // the page depends on this.
    console.warn("[webmcp] remote tools unavailable:", error);
  }
}
