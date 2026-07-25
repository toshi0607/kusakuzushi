import { describe, expect, it } from "vitest";
import { buildIntentUrl, buildShareUrl } from "./share";

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
