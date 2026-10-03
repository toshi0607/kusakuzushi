import { CLEAR_MESSAGES } from "@kusakuzushi/core/clear-message";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FONT_TEXT, FONT_TIMEOUT_MS, loadOgFonts } from "./fonts";

/**
 * The font is fetched as a `text=`-subset from Google Fonts, so a character
 * the card prints but the subset omits renders as an empty box. Nothing else
 * fails — the PNG is still 200 — so this is the only cheap guard there is.
 */
describe("FONT_TEXT", () => {
  it("covers every character of every clear message", () => {
    // #given the copy the card can print
    const covered = new Set(FONT_TEXT);
    // #when
    const missing = [...new Set(CLEAR_MESSAGES.join(""))].filter((char) => !covered.has(char));
    // #then
    expect(missing).toEqual([]);
  });

  it("covers the card's own fixed strings", () => {
    // #given the result phrase, the site label and the digits/punctuation
    const covered = new Set(FONT_TEXT);
    // #when
    const missing = [...new Set("の草を刈り取ったスコア草崩kusakuzushi.toshi0607.com0123456789%,.- ")].filter(
      (char) => !covered.has(char),
    );
    // #then
    expect(missing).toEqual([]);
  });

  it("lists each character once, so the request URL stays as short as it can", () => {
    // #given / #when
    const unique = new Set(FONT_TEXT);
    // #then
    expect(unique.size).toBe(FONT_TEXT.length);
  });
});

describe("loadOgFonts", () => {
  const neverAnswers = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives up a css2 lookup that does not answer within FONT_TIMEOUT_MS", async () => {
    // #given
    vi.useFakeTimers();
    vi.stubGlobal("fetch", neverAnswers);

    // #when
    const pending = loadOgFonts();
    const outcome = pending.then(() => "resolved", (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS);

    // #then
    expect(await outcome).toBe(`Google Fonts did not answer within ${FONT_TIMEOUT_MS}ms`);
  });

  it("covers the TTF download with the same deadline, not only the css2 lookup", async () => {
    // #given
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("fonts.googleapis.com/css2")) {
        return Promise.resolve(new Response("src: url(https://fonts.gstatic.com/x.ttf) format('truetype')"));
      }
      return neverAnswers(url, init);
    }));

    // #when
    const pending = loadOgFonts();
    const outcome = pending.then(() => "resolved", (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS);

    // #then
    expect(await outcome).toBe(`Google Fonts did not answer within ${FONT_TIMEOUT_MS}ms`);
  });

  it("asks Google Fonts again on the next render after a timed-out load", async () => {
    // #given
    vi.useFakeTimers();
    const fetchMock = vi.fn(neverAnswers);
    vi.stubGlobal("fetch", fetchMock);
    const pending = loadOgFonts();
    const outcome = pending.then(() => "resolved", (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS);
    await outcome;
    const before = fetchMock.mock.calls.length;

    // #when
    const retry = loadOgFonts();
    const retryOutcome = retry.then(() => "resolved", (error: Error) => error.message);
    try {
      await vi.advanceTimersByTimeAsync(0);

      // #then
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    } finally {
      await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS);
      await retryOutcome;
    }
  });
});
