import type { Page } from "@playwright/test";

/** Every tool the page registers, page-local and bridged, sorted as `listTools` readers sort. */
export const PAGE_TOOLS = ["get_game_state", "start_game"];
export const REMOTE_TOOLS = ["remote.get_contribution_grid", "remote.render_share_card"];
export const ALL_TOOLS = [...PAGE_TOOLS, ...REMOTE_TOOLS].sort();

/** Chrome's guidance for tool output; the same constant the tools enforce. */
export const TOOL_OUTPUT_CHAR_LIMIT = 1500;

type NativeTesting = {
  listTools(): Promise<{ name: string }[]>;
  executeTool(name: string, inputJson: string): Promise<string>;
};

/** Chromium's own view of the registered tools — the closest thing to a built-in agent these tests have. */
export async function listedToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const testing = (navigator as unknown as { modelContextTesting?: NativeTesting }).modelContextTesting;
    return testing ? (await testing.listTools()).map((tool) => tool.name).sort() : [];
  });
}

/**
 * Runs a tool through the browser's tool runner. The runner returns the
 * tool's return value JSON-encoded; a bridged remote tool returns a string
 * (the adapter flattens MCP content to text), so that string is decoded
 * once more when it is itself JSON.
 */
export async function runTool(page: Page, name: string, input: Record<string, unknown> = {}): Promise<{ value: unknown; text: string }> {
  const raw = await page.evaluate(
    async ({ name, inputJson }) => {
      const testing = (navigator as unknown as { modelContextTesting: NativeTesting }).modelContextTesting;
      return testing.executeTool(name, inputJson);
    },
    { name, inputJson: JSON.stringify(input) },
  );
  let value: unknown = JSON.parse(raw);
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

/** Everything a tool could persist in this browser, as one comparable string. */
export async function storageFingerprint(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const dump = (storage: Storage) => Object.keys(storage).sort().map((key) => [key, storage.getItem(key)]);
    const databases = "databases" in indexedDB ? (await indexedDB.databases()).map((db) => db.name).sort() : [];
    return JSON.stringify({ local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie, databases });
  });
}
