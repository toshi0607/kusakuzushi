import { describe, expect, it, vi } from "vitest";

import { compactGrid, getContributionGrid, renderShareCard, TOOL_OUTPUT_CHAR_LIMIT, type OgpClient, type ToolResult } from "./tools";

/** A full 53-week calendar (371 days) with every level present, the largest payload the tools ever see. */
function fullYear(): { total: { lastYear: number }; contributions: { date: string; count: number; level: number }[] } {
  const contributions = [];
  const start = Date.UTC(2025, 0, 5); // a Sunday, so the fold needs no leading pad
  for (let i = 0; i < 371; i += 1) {
    const level = i % 5;
    contributions.push({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), count: level * 7, level });
  }
  return { total: { lastYear: 0 }, contributions };
}

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): OgpClient & { fetch: ReturnType<typeof vi.fn> } {
  return { fetch: vi.fn(async (url: string, init?: RequestInit) => handler(url, init)) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function png(bytes = 4096, total: number | null = null): Response {
  const headers: Record<string, string> = { "content-type": "image/png" };
  if (total !== null) headers["x-kusakuzushi-total"] = String(total);
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

function text(result: ToolResult): string {
  return result.content[0].text;
}

const LONG_INPUT = "x".repeat(2000);

describe("get_contribution_grid", () => {
  it("returns the compact grid within the output budget for a full year", async () => {
    const ogp = client(() => json(fullYear()));

    const result = await getContributionGrid(ogp, { user: "toshi0607" });

    expect(result.isError).toBeUndefined();
    expect(text(result).length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    const grid = JSON.parse(text(result));
    expect(grid.user).toBe("toshi0607");
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks[0]).toBe("0123401");
    expect(grid.from).toBe("2025-01-05");
    expect(grid.to).toBe("2026-01-10");
    expect(grid.total).toBe(fullYear().contributions.reduce((sum, cell) => sum + cell.count, 0));
  });

  it("marks agent traffic and asks the OGP Worker's grid route", async () => {
    const ogp = client(() => json(fullYear()));

    await getContributionGrid(ogp, { user: "toshi0607" });

    expect(ogp.fetch).toHaveBeenCalledWith(
      "https://kusakuzushi.toshi0607.com/api/grid/toshi0607",
      expect.objectContaining({ headers: { "x-kusakuzushi-via": "mcp" } }),
    );
  });

  it("rejects an invalid username without calling upstream and without echoing it", async () => {
    const ogp = client(() => json(fullYear()));

    for (const user of [LONG_INPUT, "not_valid", "", 42, undefined, "../../etc"]) {
      const result = await getContributionGrid(ogp, { user });
      expect(result.isError).toBe(true);
      expect(text(result)).not.toContain("not_valid");
      expect(text(result)).not.toContain("xxxx");
      expect(text(result).length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    }
    expect(ogp.fetch).not.toHaveBeenCalled();
  });

  it("maps upstream 404 / 429 / 5xx / silence / malformed payloads to errors", async () => {
    expect(text(await getContributionGrid(client(() => json({}, 404)), { user: "nobody" }))).toBe("user not found: nobody");
    expect(text(await getContributionGrid(client(() => new Response(null, { status: 429 })), { user: "a" }))).toContain("rate limited");
    expect(text(await getContributionGrid(client(() => new Response(null, { status: 502 })), { user: "a" }))).toContain("status 502");
    expect(text(await getContributionGrid(client(() => { throw new Error("boom"); }), { user: "a" }))).toContain("did not answer");
    expect(text(await getContributionGrid(client(() => json({ contributions: [{ date: "x" }] })), { user: "a" }))).toContain("malformed");
    expect(text(await getContributionGrid(client(() => json({ contributions: [] })), { user: "a" }))).toContain("no contributions");
  });

  it("keeps compactGrid at 7 characters per week", () => {
    const grid = compactGrid("u", [{ date: "2025-01-08", count: 3, level: 2 }]); // a Wednesday
    expect(grid.weeks).toEqual(["0002000"]);
    expect(grid.total).toBe(3);
  });
});

describe("render_share_card", () => {
  const routes = (overrides: Partial<Record<"image" | "grid", () => Response>> = {}) =>
    client((url) => {
      if (url.includes("/og.png")) return (overrides.image ?? png)();
      if (url.includes("/api/grid/")) return (overrides.grid ?? (() => json(fullYear())))();
      return new Response(null, { status: 404 });
    });

  it("returns the card's URLs, the scored post text, and the image size within budget", async () => {
    const ogp = routes();

    const result = await renderShareCard(ogp, { user: "toshi0607", percentage: 87, score: 12340 });

    expect(result.isError).toBeUndefined();
    expect(text(result).length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    const card = JSON.parse(text(result));
    expect(card.imageUrl).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607/og.png?s=12340&p=87");
    expect(card.shareUrl).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?s=12340&p=87");
    expect(card.postText).toContain("toshi0607 の草");
    expect(card.postText).toContain("87% 刈り取った");
    expect(card.postText).toContain("スコア 12,340");
    expect(card.intentUrl).toContain("https://x.com/intent/post?text=");
    expect(card.imageBytes).toBe(4096);
    expect(card.imageContentType).toBe("image/png");
    expect(ogp.fetch).toHaveBeenCalledWith(card.imageUrl, expect.objectContaining({ headers: { "x-kusakuzushi-via": "mcp" } }));
  });

  it("takes the total from the card's own header and skips the grid lookup when it is there", async () => {
    const ogp = routes({ image: () => png(4096, 2942) });

    const card = JSON.parse(text(await renderShareCard(ogp, { user: "toshi0607", percentage: 87, score: 12340 })));

    expect(card.postText).toContain("2,942 contributions");
    expect(ogp.fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed total header and falls back to the grid route", async () => {
    const ogp = routes({ image: () => new Response(new Uint8Array(10), { headers: { "content-type": "image/png", "x-kusakuzushi-total": "lots" } }) });

    const card = JSON.parse(text(await renderShareCard(ogp, { user: "toshi0607", percentage: 87, score: 1 })));

    expect(card.postText).toMatch(/[\d,]+ contributions/);
    expect(ogp.fetch).toHaveBeenCalledTimes(2);
  });

  it("omits the score line and the grid lookup for a rate-only card", async () => {
    const ogp = routes();

    const result = await renderShareCard(ogp, { user: "toshi0607", percentage: 50 });

    const card = JSON.parse(text(result));
    expect(card.score).toBeNull();
    expect(card.imageUrl).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607/og.png?p=50");
    expect(card.postText).not.toContain("スコア");
    expect(ogp.fetch).toHaveBeenCalledTimes(1);
  });

  it("validates every input before touching upstream", async () => {
    const ogp = routes();

    const cases: { user?: unknown; percentage?: unknown; score?: unknown }[] = [
      { user: LONG_INPUT, percentage: 50 },
      { user: "toshi0607", percentage: 101 },
      { user: "toshi0607", percentage: -1 },
      { user: "toshi0607", percentage: 50.5 },
      { user: "toshi0607", percentage: "50" },
      { user: "toshi0607", percentage: 50, score: -1 },
      { user: "toshi0607", percentage: 50, score: 1.5 },
      { user: "toshi0607", percentage: 50, score: LONG_INPUT },
    ];
    for (const input of cases) {
      const result = await renderShareCard(ogp, input);
      expect(result.isError).toBe(true);
      expect(text(result)).not.toContain("xxxx");
    }
    expect(ogp.fetch).not.toHaveBeenCalled();
  });

  it("surfaces the OGP Worker's rate limit and outages as errors", async () => {
    expect(text(await renderShareCard(routes({ image: () => new Response(null, { status: 429 }) }), { user: "a", percentage: 1 }))).toContain("rate limited");
    expect(text(await renderShareCard(routes({ image: () => new Response(null, { status: 503 }) }), { user: "a", percentage: 1 }))).toContain("status 503");
    expect(text(await renderShareCard(routes({ grid: () => new Response(null, { status: 502 }) }), { user: "a", percentage: 1, score: 1 }))).toContain("retry");
  });

  it("never returns the image itself", async () => {
    const result = await renderShareCard(routes({ image: () => png(200_000) }), { user: "a", percentage: 1 });

    expect(text(result).length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    expect(JSON.parse(text(result)).imageBytes).toBe(200_000);
  });
});
