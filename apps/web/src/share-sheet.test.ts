/**
 * @vitest-environment jsdom
 *
 * Covers what `saveCanvasImage` hands to the share sheet. jsdom implements
 * neither `canvas.toBlob` nor the Web Share API, so both are stubbed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { saveCanvasImage } from "./share";

const CAPTION = {
  text: "toshi0607 の草 2,942 contributions を 87% 刈り取った🌱 スコア 12,340 #草崩し",
  url: "https://kusakuzushi.toshi0607.com/share/toshi0607?s=12340&p=87",
};

function stubCanvasBlob(): HTMLCanvasElement {
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  return document.createElement("canvas");
}

function stubNavigatorShare(canShare: (data?: ShareData) => boolean): ReturnType<typeof vi.fn> {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "canShare", { configurable: true, value: vi.fn(canShare) });
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  return share;
}

describe("saveCanvasImage", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
    vi.restoreAllMocks();
  });

  it("hands the post text and the share link to the share sheet together with the image", async () => {
    // #given a platform that accepts a file, post text and a URL together
    const canvas = stubCanvasBlob();
    const share = stubNavigatorShare(() => true);
    // #when
    await saveCanvasImage(canvas, "toshi0607", CAPTION);
    // #then
    expect(share.mock.calls).toEqual([
      [
        {
          files: [expect.objectContaining({ name: "kusakuzushi-toshi0607.png" })],
          text: CAPTION.text,
          url: CAPTION.url,
        },
      ],
    ]);
  });

  it("shares the image alone when the platform refuses text and a link next to a file", async () => {
    // #given a platform that accepts only a file payload
    const canvas = stubCanvasBlob();
    const share = stubNavigatorShare((data) => data?.text === undefined);
    // #when
    await saveCanvasImage(canvas, "toshi0607", CAPTION);
    // #then
    expect(share.mock.calls).toEqual([[{ files: [expect.any(File)] }]]);
  });
});
