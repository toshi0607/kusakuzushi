/**
 * 「最初の描画が JS を待たない」ことを index.html の中身で担保する。
 *
 * これは見た目のテストではなく **パフォーマンスの不変条件** のテスト。
 * `#app` を空にしてシェルを JS で組み立てると、First Contentful Paint と
 * LCP がバンドルのダウンロードと実行の後ろに落ちる。localhost 配信の
 * `pnpm lh` はそれでも 100 点を出すので、本番でだけ FCP が 4s 台になって
 * 初めて気づくことになる(セッション12)。
 *
 * Lighthouse 側のしきい値ではこれを守れない: GitHub のランナーは
 * ばらつきが大きく(`slow` ジョブ実測で FCP 827〜1857ms)、往復 1 回ぶんの
 * 劣化を検出できるほど厳しい ms しきい値を置くと不安定になる。
 * 「HTML だけで読める文字があること」を直接書いたほうが決定的で速い。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

/** `#app` の中身(ここが空だと最初の描画が JS 待ちになる)。 */
const appInnerHtml = html.match(/<div id="app">([\s\S]*?)<\/div>\s*<script/)?.[1] ?? "";

describe("index.html のページシェル", () => {
  it("LCP 要素になる見出しとサブタイトルを静的マークアップとして持つ", () => {
    // #then — この 2 つは app.ts ではなく HTML が持っていること
    expect(appInnerHtml).toContain("草崩し");
    expect(appInnerHtml).toContain("GitHub の草を、ブロック崩しで刈り取ろう");
  });

  it("app.ts が中身を差し込むステージ枠を持つ(findStage が探すセレクタ)", () => {
    // #then
    expect(appInnerHtml).toContain('<main class="stage">');
  });

  it("#app が空でない(空にすると最初の描画がバンドルの実行待ちになる)", () => {
    // #then
    expect(appInnerHtml.trim().length).toBeGreaterThan(0);
    expect(html).not.toContain('<div id="app"></div>');
  });
});
