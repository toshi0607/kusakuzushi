import { describe, expect, it } from "vitest";
import { buildHarvestIntentUrl, buildIntentUrl, buildShareUrl } from "./share-link";

describe("buildShareUrl", () => {
  it("points at the OGP worker's /share/{user} route with score and percentage", () => {
    // #given / #when
    const url = buildShareUrl("toshi0607", 87, 12340);

    // #then
    expect(url).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?s=12340&p=87");
  });

  it("percent-encodes the username path segment", () => {
    // #given / #when
    const url = buildShareUrl("a/b?c", 10, 5);

    // #then
    expect(url).toBe("https://kusakuzushi.toshi0607.com/share/a%2Fb%3Fc?s=5&p=10");
  });

  it("omits `s` entirely when no score is shared", () => {
    // #given / #when 拡張の共有(スコアを載せない)
    const url = buildShareUrl("toshi0607", 87);

    // #then `s=0` ではなく `s` そのものがない — Worker はこれを「スコア行なし」
    // として扱うので、0 点のカードが出てしまわない
    expect(url).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?p=87");
  });
});

describe("buildIntentUrl", () => {
  it("embeds the share URL and a formatted result text", () => {
    // #given / #when
    const url = buildIntentUrl("toshi0607", 2942, 87, 12340);

    // #then
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://x.com/intent/post");
    expect(parsed.searchParams.get("url")).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?s=12340&p=87");
    expect(parsed.searchParams.get("text")).toBe("toshi0607 の草 2,942 contributions を 87% 刈り取った🌱 スコア 12,340 #草崩し");
  });
});

describe("buildHarvestIntentUrl", () => {
  it("posts the harvest percentage and the hashtag, with no score", () => {
    // #given / #when
    const url = buildHarvestIntentUrl("toshi0607", 87);

    // #then
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://x.com/intent/post");
    expect(parsed.searchParams.get("text")).toBe("toshi0607 の草を GitHub 上で 87% 刈り取った🌱 #草崩し");
    expect(parsed.searchParams.get("url")).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?p=87");
  });

  it("never leaks a score into the extension's post", () => {
    // #given / #when 拡張のスコアは level² 由来で web と桁が違う(adapter.ts)。
    // 文面にも URL にも出てはいけない。
    const url = buildHarvestIntentUrl("toshi0607", 100);

    // #then
    expect(url).not.toContain("スコア");
    expect(new URL(url).searchParams.get("url")).not.toContain("s=");
  });

  it("carries the same hashtag as the web post so both are one stream", () => {
    // #given / #when
    const web = new URL(buildIntentUrl("toshi0607", 2942, 87, 12340)).searchParams.get("text") ?? "";
    const extension = new URL(buildHarvestIntentUrl("toshi0607", 87)).searchParams.get("text") ?? "";

    // #then
    expect(web).toContain("#草崩し");
    expect(extension).toContain("#草崩し");
  });
});
