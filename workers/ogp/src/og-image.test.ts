import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { imageResponseMock, loadOgFontsMock } = vi.hoisted(() => ({
  imageResponseMock: vi.fn(),
  loadOgFontsMock: vi.fn(),
}));

vi.mock("workers-og", () => ({ ImageResponse: imageResponseMock }));
vi.mock("./fonts", () => ({ loadOgFonts: loadOgFontsMock }));

import { renderOgImage } from "./og-image";

const VALID_RESPONSE = {
  contributions: [
    { date: "2024-01-01", count: 0, level: 0 },
    { date: "2024-01-02", count: 1, level: 1 },
  ],
};

describe("renderOgImage contribution response limits", () => {
  beforeEach(() => {
    imageResponseMock.mockImplementation(function ImageResponseMock() {
      return new Response("png");
    });
    loadOgFontsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the grid for a normal response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(VALID_RESPONSE))));

    await expect(renderOgImage("octocat", 1, 50)).resolves.toMatchObject({ gridIncluded: true });
  });

  it("falls back to a grid-less card when Content-Length exceeds the response limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(VALID_RESPONSE), { headers: { "content-length": String(64 * 1024 + 1) } })),
    );

    await expect(renderOgImage("octocat", 1, 50)).resolves.toMatchObject({ gridIncluded: false });
  });

  it("cancels a header-less response that exceeds the response limit and falls back", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));

    await expect(renderOgImage("octocat", 1, 50)).resolves.toMatchObject({ gridIncluded: false });
    expect(cancelled).toBe(true);
  });
});
