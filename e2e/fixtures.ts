import type { Page } from "@playwright/test";

/** Every tool the page registers, page-local and bridged, sorted as `getTools` readers sort. */
export const PAGE_TOOLS = ["get_game_state", "start_game"];
export const REMOTE_TOOLS = ["remote.get_contribution_grid", "remote.render_share_card"];
export const ALL_TOOLS = [...PAGE_TOOLS, ...REMOTE_TOOLS].sort();

/** Chrome's guidance for tool output; the same constant the tools enforce. */
export const TOOL_OUTPUT_CHAR_LIMIT = 1500;

/** Chromium's own view of the registered tools — the closest thing to a built-in agent these tests have. */
export async function listedToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = (document as unknown as { modelContext?: { getTools(): Promise<{ name: string }[]> } }).modelContext;
    return context ? (await context.getTools()).map((tool) => tool.name).sort() : [];
  });
}

/**
 * Runs a registered tool through `document.modelContext`. The runner returns
 * objects JSON-encoded; string results may be verbatim or JSON-encoded.
 * A bridged remote tool returns a string (the adapter flattens MCP content to
 * text), so that string is decoded once more when it is itself JSON.
 */
export async function runTool(page: Page, name: string, input: Record<string, unknown> = {}): Promise<{ value: unknown; text: string }> {
  const raw = await page.evaluate(
    async ({ name, inputJson }) => {
      const context = (document as unknown as { modelContext: {
        getTools(): Promise<{ name: string }[]>;
        executeTool(tool: { name: string }, inputJson: string): Promise<string>;
      } }).modelContext;
      const tool = (await context.getTools()).find((tool) => tool.name === name);
      if (!tool) throw new Error(`tool not registered: ${name}`);
      return context.executeTool(tool, inputJson);
    },
    { name, inputJson: JSON.stringify(input) },
  );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // A plain string result (an error message, say) stays a string.
    }
  }
  return { value, text };
}

/** Runs a registered tool and captures the browser's rejection inside the page. */
export async function runToolSettled(page: Page, name: string, input: Record<string, unknown> = {}): Promise<{ ok: true; result: string } | { ok: false; result: string }> {
  return page.evaluate(
    async ({ name, inputJson }) => {
      try {
        const context = (document as unknown as { modelContext: {
          getTools(): Promise<{ name: string }[]>;
          executeTool(tool: { name: string }, inputJson: string): Promise<string>;
        } }).modelContext;
        const tool = (await context.getTools()).find((tool) => tool.name === name);
        if (!tool) throw new Error(`tool not registered: ${name}`);
        return { ok: true as const, result: await context.executeTool(tool, inputJson) };
      } catch (error) {
        return { ok: false as const, result: String(error) };
      }
    },
    { name, inputJson: JSON.stringify(input) },
  );
}

/** Everything a tool could persist in this browser, as one comparable string. */
export async function storageFingerprint(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const dump = (storage: Storage) => Object.keys(storage).sort().map((key) => [key, storage.getItem(key)]);
    const databases = "databases" in indexedDB ? (await indexedDB.databases()).map((db) => db.name).sort() : [];
    return JSON.stringify({ local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie, databases });
  });
}
