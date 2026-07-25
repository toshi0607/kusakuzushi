import { describe, expect, it } from "vitest";
import { buildOgImageHtml } from "./og-image-html";

describe("buildOgImageHtml", () => {
  it("embeds the username (bold), percentage, and formatted score", () => {
    // #given / #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 12340, percentage: 87, gridSvgDataUri: null });
    // #then
    expect(html).toContain('font-weight:700;">toshi0607</span>');
    expect(html).toContain("87%");
    expect(html).toContain("スコア 12,340");
    expect(html).toContain("kusakuzushi.toshi0607.com");
  });

  it("uses the GitHub-dark background and accent colors", () => {
    // #given / #when
    const html = buildOgImageHtml({ user: "octocat", score: 0, percentage: 0, gridSvgDataUri: null });
    // #then
    expect(html).toContain("#0d1117");
    expect(html).toContain("#e6edf3");
    expect(html).toContain("#39d353");
  });

  it("embeds the grid svg data URI as an <img> when provided", () => {
    // #given
    const dataUri = "data:image/svg+xml;base64,AAAA";
    // #when
    const html = buildOgImageHtml({ user: "octocat", score: 1, percentage: 1, gridSvgDataUri: dataUri });
    // #then
    expect(html).toContain(`<img src="${dataUri}" style="width:1088px; height:140px;" />`);
  });

  it("omits the grid <img> entirely when the grid could not be fetched", () => {
    // #given a null grid (fetch failure fallback)
    // #when
    const html = buildOgImageHtml({ user: "octocat", score: 1, percentage: 1, gridSvgDataUri: null });
    // #then
    expect(html).not.toContain("<img");
  });

  it("escapes the username when interpolated", () => {
    // #given a username that could never pass the GitHub charset check, exercised
    // here purely to prove the escape path is used regardless of validation upstream
    // #when
    const html = buildOgImageHtml({ user: "<b>", score: 0, percentage: 0, gridSvgDataUri: null });
    // #then
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
