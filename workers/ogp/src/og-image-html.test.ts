import { SHARE_INVITATION, SITE_HOST } from "@kusakuzushi/core/share-link";
import { describe, expect, it } from "vitest";

import { buildOgImageHtml } from "./og-image-html";

describe("buildOgImageHtml", () => {
  const clearedCard = {
    user: "toshi0607",
    score: 12340,
    percentage: 100,
    gridSvgDataUri: "data:image/svg+xml;base64,AAAA",
    taunt: "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？",
  };
  const cardVariants = [
    { name: "cleared card", input: clearedCard },
    {
      name: "no-taunt card",
      input: { user: "toshi0607", score: 8200, percentage: 64, gridSvgDataUri: "data:image/svg+xml;base64,AAAA", taunt: null },
    },
  ];

  it("embeds the username (bold), percentage, and formatted score", () => {
    // #given / #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 12340, percentage: 87, gridSvgDataUri: null });
    // #then
    expect(html).toContain('font-weight:700; white-space:nowrap;">toshi0607</span>');
    expect(html).toContain("87%");
    expect(html).toContain("スコア 12,340");
    expect(html).toContain("kusakuzushi.toshi0607.com");
  });

  it("omits the score line entirely when no score was shared", () => {
    // #given 拡張からの共有(`s` なし)。「スコア 0」を焼き付けると、100%
    // 刈り取ったカードに 0 点と書くことになる。
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: null, percentage: 87, gridSvgDataUri: null });
    // #then 率と名前は残り、スコア行だけが消える
    expect(html).not.toContain("スコア");
    expect(html).toContain("87%");
    expect(html).toContain('font-weight:700; white-space:nowrap;">toshi0607</span>');
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
    const taunt = clearedCard.taunt;
    // #when
    const html = buildOgImageHtml({ ...clearedCard, gridSvgDataUri: null });
    // #then
    expect(html).toContain(taunt);
  });

  it("omits the taunt line when there is none (gameOver, or an unknown total)", () => {
    // #given / #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 12340, percentage: 64, gridSvgDataUri: null, taunt: null });
    // #then no taunt block is printed
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
    // #when
    const html = buildOgImageHtml({ ...clearedCard, gridSvgDataUri: null });
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

  it("prints the product line above the result, in the saved image's order", () => {
    // #given a no-taunt card
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 8200, percentage: 64, gridSvgDataUri: null, taunt: null });
    // #then
    const positions = ["草崩し", SHARE_INVITATION, SITE_HOST, "刈り取った"].map((text) => html.indexOf(text));
    expect(
      positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])),
    ).toBe(true);
  });

  it("keeps the bottom of the card clear for X's title label", () => {
    // #given a cleared card
    // #when
    const html = buildOgImageHtml(clearedCard);
    // #then
    expect(html).toContain("padding:56px 56px 126px;");
  });

  it("draws a rule under the product line", () => {
    // #given a cleared card
    // #when
    const html = buildOgImageHtml(clearedCard);
    // #then
    expect(html).toMatch(/<\/span>\s*<\/div>\s*<div style="display:flex; height:2px; margin-top:16px; background:#30363d;"><\/div>/);
  });

  it("paints neither the product line nor the rule green", () => {
    // #given a cleared card
    // #when
    const html = buildOgImageHtml(clearedCard);
    const gridIndex = html.indexOf('<div style="display:flex; margin-top:20px;">');
    if (gridIndex === -1) {
      throw new Error("Expected the grid container before checking the product line and rule colors");
    }
    // #then
    expect(html.slice(0, gridIndex)).not.toContain("#39d353");
  });

  it("keeps a long username on one line so a hyphen cannot split it", () => {
    // #given a gameOver card for a hyphenated name wider than the content box at 48px
    // #when
    const html = buildOgImageHtml({ user: "aaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbb", score: 1234, percentage: 56, gridSvgDataUri: null, taunt: null });
    // #then the name span cannot wrap at the hyphen and push the score onto the phrase
    expect(html).toContain('white-space:nowrap;">aaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbb</span>');
  });

  it("tightens the gameOver result line so a wrapped name keeps the score above X's label", () => {
    // #given a gameOver card (a 21+ character name wraps this line onto two)
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 8200, percentage: 64, gridSvgDataUri: null, taunt: null });
    // #then
    expect(html).toContain("font-size:48px; line-height:1.2;");
  });

  it("grows the product line's left group so the host reaches the right edge", () => {
    // #given a no-taunt card
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", score: 8200, percentage: 64, gridSvgDataUri: null, taunt: null });
    // #then
    expect(html).toMatch(/<div style="display:flex; flex:1; align-items:center;">\s*<span[^>]*>草崩し<\/span>/);
  });

  it.each([
    { score: 8200, percentage: 64, taunt: null },
    { ...clearedCard, gridSvgDataUri: null },
    { score: null, percentage: 87 },
  ])("prints the product line for a card with score $score and percentage $percentage", (input) => {
    // #given a no-taunt, cleared, or score-less card
    // #when
    const html = buildOgImageHtml({ user: "toshi0607", gridSvgDataUri: null, ...input });
    // #then
    const missing = ["草崩し", SHARE_INVITATION, SITE_HOST].filter(
      (text) => !html.includes(text),
    );
    expect(missing).toEqual([]);
  });

  it.each(cardVariants)("declares display:flex in the style of every div and span for satori on the $name", ({ input }) => {
    // #given a cleared or no-taunt card with a score and a grid
    // #when
    const html = buildOgImageHtml(input);
    const missing = (html.match(/<(?:div|span)\b[^>]*>/g) ?? []).filter(
      (tag) => !/style="[^"]*display:flex;/.test(tag),
    );
    // #then
    expect(missing).toEqual([]);
  });

  it.each(cardVariants)("prints no HTML entities when the $name needs no escaping", ({ input }) => {
    // #given a valid username and a base64 grid data URI
    // #when
    const html = buildOgImageHtml(input);
    // #then
    expect(html).not.toMatch(/&[a-zA-Z#][a-zA-Z0-9]*;/);
  });
});
