/**
 * Registers the page's tools on `document.modelContext` (falling back to
 * `navigator.modelContext` on older Chrome) and mirrors the remote MCP server's
 * tools (workers/mcp, same origin at `/mcp`) in beside them through Cloudflare's
 * WebMCP adapter.
 *
 * Loaded only when the browser has a native `document.modelContext` or its
 * older `navigator.modelContext` alias (main.ts gates the import): without
 * one the adapter is a documented no-op, and the adapter alone is ~90 KB
 * gzipped of MCP client — far more than this page's whole script budget
 * (lighthouserc.cjs).
 *
 * The adapter is experimental and pinned exactly (apps/web/package.json);
 * it only reads `navigator.modelContext`, so the page aliases that to
 * `document.modelContext` when Chrome no longer provides it (Chrome 153).
 * See tasks/webmcp-article-notes.md.
 */

import { registerWebMcp } from "agents/experimental/webmcp";

import type { AppController } from "../app";
import { createPageTools } from "./tools";

/** Remote tools show up as `remote.<name>` so they can never shadow a page tool (collisions are silent). */
export const REMOTE_TOOL_PREFIX = "remote.";
/**
 * Per-request cap for `tools/list` and `tools/call`. A card render waits up
 * to 10 s for the upstream (workers/ogp UPSTREAM_TIMEOUT_MS, font load in
 * parallel) plus a cold render of about 4 s; the MCP Worker's own cap is
 * OGP_TIMEOUT_MS (workers/mcp/src/tools.ts), the same 20 s.
 */
const REMOTE_TIMEOUT_MS = 20_000;

function aliasModelContextForAdapter(context: NonNullable<Navigator["modelContext"]>): void {
  // Chrome 153 dropped the navigator alias; the adapter only reads navigator.modelContext.
  if (!("modelContext" in navigator)) {
    Object.defineProperty(navigator, "modelContext", { value: context, configurable: true });
  }
}

export async function registerWebMcpTools(controller: AppController, signal: AbortSignal): Promise<void> {
  const context = document.modelContext ?? navigator.modelContext;
  if (!context) {
    return;
  }

  // Page tools first: they are the ones an agent should find even when the
  // Worker is unreachable, and the spec has no unregister call — a tool goes
  // away only with the signal it was registered under.
  for (const tool of createPageTools(controller)) {
    if (signal.aborted) return;
    const registration = context.registerTool(tool, { signal }) as void | Promise<unknown>;
    if (registration && typeof registration.then === "function") {
      registration.catch((err) => console.warn("[webmcp] tool registration failed:", err));
    }
  }

  try {
    aliasModelContextForAdapter(context);
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
