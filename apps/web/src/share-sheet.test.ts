/**
 * @vitest-environment jsdom
 *
 * Covers what `saveCanvasImage` hands to the share sheet. jsdom implements
 * neither `canvas.toBlob` nor the Web Share API, so both are stubbed.
 */

import { buildIntentText, buildShareUrl } from "@kusakuzushi/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveCanvasImage } from "./share";

/** The caption the result screen passes: the X button's post text and share link. */
const CAPTION = {
  text: buildIntentText("toshi0607", 2942, 87, 12340),
  url: buildShareUrl("toshi0607", 87, 12340),
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

function stubDownload(): string[] {
  const downloads: string[] = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:card") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn((_url: string) => undefined) });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  return downloads;
}

describe("saveCanvasImage", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
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

  it("downloads the image rather than opening a sheet that cannot carry the file", async () => {
    // #given a platform whose canShare accepts text and a link but not a file
    const downloads = stubDownload();
    const canvas = stubCanvasBlob();
    const share = stubNavigatorShare((data) => data?.text !== undefined);
    // #when
    await saveCanvasImage(canvas, "toshi0607", CAPTION);
    // #then
    expect({ shared: share.mock.calls.length, downloads }).toEqual({
      shared: 0,
      downloads: ["kusakuzushi-toshi0607.png"],
    });
  });

  it("downloads the image when the platform has no Web Share API", async () => {
    // #given neither navigator.canShare nor navigator.share is defined
    const downloads = stubDownload();
    const canvas = stubCanvasBlob();
    // #when
    await saveCanvasImage(canvas, "toshi0607", CAPTION);
    // #then
    expect(downloads).toEqual(["kusakuzushi-toshi0607.png"]);
  });

  it("does not download when the player dismisses the share sheet", async () => {
    // #given canShare returns true and share rejects with AbortError
    const downloads = stubDownload();
    const canvas = stubCanvasBlob();
    const share = stubNavigatorShare(() => true);
    share.mockRejectedValue(new DOMException("dismissed", "AbortError"));
    // #when
    await saveCanvasImage(canvas, "toshi0607", CAPTION);
    // #then
    expect(downloads).toEqual([]);
  });

  it("downloads the image when sharing fails for any other reason", async () => {
    // #given canShare returns true and share rejects with NotAllowedError
    const downloads = stubDownload();
    const canvas = stubCanvasBlob();
    const share = stubNavigatorShare(() => true);
    share.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    // #when
    await saveCanvasImage(canvas, "toshi0607", CAPTION);
    // #then
    expect(downloads).toEqual(["kusakuzushi-toshi0607.png"]);
  });
});
