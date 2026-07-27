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

  it("adds the taunt line when the round was a full clear", () => {
    // #given a 100% card carrying the app's own taunt
    const taunt = "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？";
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 12340, percentage: 100, gridSvgDataUri: null, taunt });
    // #then
    expect(html).toContain(taunt);
  });

  it("omits the taunt line when there is none (gameOver, or an unknown total)", () => {
    // #given / #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 12340, percentage: 64, gridSvgDataUri: null, taunt: null });
    // #then only the two existing text blocks remain
    expect(html).toContain("64%");
    expect(html).not.toContain("font-size:34px");
  });

  it("escapes the taunt like every other caller-supplied string", () => {
    // #given a taunt carrying markup (defence in depth: the table is ours today)
    // #when
    const html = buildOgImageHtml({ user: "u", score: 1, percentage: 100, gridSvgDataUri: null, taunt: "<b>x</b>" });
    // #then
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("demotes the who/how-much line below the taunt on a clear card", () => {
    // #given a cleared card (the taunt is the line that is specific to this game)
    const taunt = "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？";
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 12340, percentage: 100, gridSvgDataUri: null, taunt });
    // #then the context line is smaller than the taunt, and the taunt beats the score
    expect(html).toContain("font-size:26px");
    expect(html).toContain("font-size:34px");
    expect(html).toContain("font-size:30px");
    expect(html).not.toContain("font-size:48px");
  });

  it("keeps the original hierarchy when there is no taunt", () => {
    // #given a gameOver card
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 8200, percentage: 64, gridSvgDataUri: null, taunt: null });
    // #then
    expect(html).toContain("font-size:48px");
    expect(html).toContain("font-size:40px");
  });
});
