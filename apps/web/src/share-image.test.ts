/**
 * @vitest-environment jsdom
 *
 * Covers `composeResultImage`'s text block. jsdom has no 2D context, so this
 * stubs one that records every `fillText` — enough to assert what the card
 * says and that the last line still lands inside the 630px card.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { composeResultImage } from "./share";

const CARD_HEIGHT = 630;

type DrawnText = { text: string; x: number; y: number; font: string };

function stubRecordingContext(): DrawnText[] {
  const drawn: DrawnText[] = [];
  const ctx = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: (text: string, x: number, y: number) => {
      drawn.push({ text, x, y, font: ctx.font });
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D & { font: string };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return drawn;
}

/** A stand-in for the finished board; only its dimensions are read. */
function sourceBoard(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 360;
  return canvas;
}

function fontSizeOf(entry: DrawnText): number {
  return Number.parseInt(entry.font, 10);
}

describe("composeResultImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the taunt, and prints it larger than the state label", () => {
    // #given a cleared round carrying the panel's taunt
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 12340,
      percentage: 100,
      cleared: true,
      taunt: "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？",
    });
    // #then
    const taunt = drawn.find((entry) => entry.text.startsWith("地道に"));
    const label = drawn.find((entry) => entry.text.startsWith("@toshi0607"));
    expect(taunt).toBeDefined();
    expect(fontSizeOf(taunt!)).toBeGreaterThan(fontSizeOf(label!));
  });

  it("puts the taunt inside the board, not in the caption block below it", () => {
    // #given a cleared board: every brick is gone, so the snapshot's lower
    // two thirds are empty and the taunt goes there (DESIGN-VISUAL §8)
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 12340,
      percentage: 100,
      cleared: true,
      taunt: "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？",
    });
    // #then it sits above the handle line, which is the top of the caption
    const taunt = drawn.find((entry) => entry.text.startsWith("地道に"));
    const label = drawn.find((entry) => entry.text.startsWith("@toshi0607"));
    expect(taunt!.y).toBeLessThan(label!.y);
  });

  it("keeps every line inside the 630px card when the taunt is present", () => {
    // #given the tallest case: state label + taunt + stats + product line
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 12340,
      percentage: 100,
      cleared: true,
      taunt: "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？",
    });
    // #then every line's bottom (top y + its own font size) fits
    for (const entry of drawn) {
      expect(entry.y + fontSizeOf(entry)).toBeLessThanOrEqual(CARD_HEIGHT);
    }
  });

  it("says nothing extra on a gameOver card", () => {
    // #given a round that ended with bricks still standing
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 8200,
      percentage: 64,
      cleared: false,
      taunt: null,
    });
    // #then the result and the product line are drawn, with no clear-only taunt
    expect(drawn.map((entry) => entry.text)).toEqual([
      "@toshi0607",
      "スコア 8,200 / 刈り取り率 64%",
      "草崩し",
      "あなたの草もどうですか？",
      "kusakuzushi.toshi0607.com",
    ]);
  });

  it.each([
    [
      "a cleared card",
      {
        score: 12340,
        percentage: 100,
        cleared: true,
        taunt: "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？",
      },
    ],
    ["a gameOver card", { score: 8200, percentage: 64, cleared: false, taunt: null }],
  ])("ends %s with the product line: wordmark, invitation, site host", (_name, result) => {
    // #given a result card in either terminal state
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", result);
    // #then
    expect(drawn.slice(-3).map((entry) => entry.text)).toEqual([
      "草崩し",
      "あなたの草もどうですか？",
      "kusakuzushi.toshi0607.com",
    ]);
  });

  it("sets the invitation and the site host in the body face", () => {
    // #given a gameOver card and a display face whose `text=` subset lacks the host's lowercase letters
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 8200,
      percentage: 64,
      cleared: false,
      taunt: null,
    });
    // #then missing glyphs cannot silently fall back from DotGothic16
    const productCopy = drawn.filter(
      (entry) => entry.text === "あなたの草もどうですか？" || entry.text === "kusakuzushi.toshi0607.com",
    );
    expect(productCopy.map((entry) => entry.font.includes("DotGothic16"))).toEqual([false, false]);
  });

  it("starts the invitation to the right of the wordmark", () => {
    // #given a gameOver card
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 8200,
      percentage: 64,
      cleared: false,
      taunt: null,
    });
    // #then
    const wordmark = drawn.find((entry) => entry.text === "草崩し");
    const invitation = drawn.find((entry) => entry.text === "あなたの草もどうですか？");
    expect(invitation!.x).toBeGreaterThan(wordmark!.x);
  });

  it("leaves the 30px bottom margin under the product line", () => {
    // #given a gameOver card
    const drawn = stubRecordingContext();
    // #when
    composeResultImage(sourceBoard(), "toshi0607", {
      score: 8200,
      percentage: 64,
      cleared: false,
      taunt: null,
    });
    // #then
    const lastThree = drawn.slice(-3);
    expect(Math.max(...lastThree.map((entry) => entry.y + fontSizeOf(entry)))).toBeLessThanOrEqual(CARD_HEIGHT - 30);
  });
});
