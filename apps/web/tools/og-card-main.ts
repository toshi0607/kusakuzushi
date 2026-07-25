/**
 * `tools/og-card.html` のブートストラップ。フォントを確実にロードしてから
 * カードを合成し、プレビューと「public/og.png に書き出す」ボタンを出す。
 * 書き出しは dev 専用エンドポイント(vite.config.ts の og-card-writer)へ POST する。
 * 手順は og-card.ts のヘッダを参照。
 */

import { composeOgCard } from "./og-card";

const SAVE_ENDPOINT = "/__save-og-card";

// フォント未ロードのまま描くと sans-serif で焼き込まれてしまうため、
// 使用する字面をすべて指定して load を待ってから合成する。
const FONT_LOADS: readonly [string, string][] = [
  ['60px "DotGothic16"', "草崩し"],
  ['26px "IBM Plex Sans JP"', "GitHubの草を、ブロック崩しで刈り取ろうkusakuzushi.toshi0607.com"],
];

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG の生成に失敗しました"))), "image/png");
  });
}

async function main(): Promise<void> {
  await Promise.all(FONT_LOADS.map(([font, text]) => document.fonts.load(font, text)));

  const canvas = composeOgCard();
  canvas.style.width = "600px";
  canvas.style.height = "315px";
  document.body.appendChild(canvas);

  const status = document.createElement("p");
  document.body.appendChild(status);

  const save = document.createElement("button");
  save.textContent = "public/og.png に書き出す";
  save.addEventListener("click", () => {
    status.textContent = "書き出し中…";
    void canvasToBlob(canvas)
      .then((blob) => fetch(SAVE_ENDPOINT, { method: "POST", body: blob }))
      .then(async (response) => {
        const body = await response.text();
        status.textContent = response.ok ? `保存しました: ${body}` : `失敗: ${body}`;
      })
      .catch((error: unknown) => {
        status.textContent = `失敗: ${String(error)}`;
      });
  });
  document.body.appendChild(save);
}

void main();
