import { describe, expect, it } from "vitest";
import { buildOgImageUrl, buildOgpHtml, buildShareUrl } from "./ogp-page";

describe("buildShareUrl", () => {
  it("points at /share/{user} with score and percentage", () => {
    // #given / #when
    const url = buildShareUrl("toshi0607", 12340, 87);
    // #then
    expect(url).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?s=12340&p=87");
  });
});

describe("buildOgImageUrl", () => {
  it("points at /share/{user}/og.png with score and percentage", () => {
    // #given / #when
    const url = buildOgImageUrl("toshi0607", 12340, 87);
    // #then
    expect(url).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607/og.png?s=12340&p=87");
  });
});

describe("buildOgpHtml", () => {
  it("embeds the title, description, image, and url OGP tags", () => {
    // #given
    const html = buildOgpHtml("toshi0607", 12340, 87);
    // #then
    expect(html).toContain('<meta property="og:title" content="toshi0607 の草を 87% 刈り取った🌱" />');
    expect(html).toContain(
      '<meta property="og:description" content="スコア 12,340 — 草崩し: GitHub の草ブロック崩し" />',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://kusakuzushi.toshi0607.com/share/toshi0607/og.png?s=12340&amp;p=87" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://kusakuzushi.toshi0607.com/share/toshi0607?s=12340&amp;p=87" />',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain(
      '<meta name="twitter:image" content="https://kusakuzushi.toshi0607.com/share/toshi0607/og.png?s=12340&amp;p=87" />',
    );
  });

  it("declares the image dimensions so crawlers can pick the large-card layout", () => {
    // #given / #when
    const html = buildOgpHtml("toshi0607", 12340, 87);
    // #then
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
  });

  it("formats a large score with thousands separators", () => {
    // #given / #when
    const html = buildOgpHtml("octocat", 1234567, 50);
    // #then
    expect(html).toContain("スコア 1,234,567");
  });

  it("renders 0% and score 0 when both are absent (defaulted upstream)", () => {
    // #given / #when
    const html = buildOgpHtml("octocat", 0, 0);
    // #then
    expect(html).toContain('content="octocat の草を 0% 刈り取った🌱"');
    expect(html).toContain("スコア 0");
  });
});
