/**
 * `tools/promo-tile.html` のブートストラップ。フォントを確実にロードしてから
 * タイルを合成し、プレビューと書き出しボタンを出す。書き出しは dev 専用
 * エンドポイント(vite.config.ts の card-writer)へ POST する。
 */

import { composePromoTile } from "./promo-tile";

const SAVE_ENDPOINT = "/__save-card?target=promo-tile";

// フォント未ロードのまま描くと sans-serif で焼き込まれてしまうため、
// 使用する字面を指定して load を待ってから合成する。
const FONT_LOADS: readonly [string, string][] = [['54px "DotGothic16"', "草崩し"]];

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG の生成に失敗しました"))), "image/png");
  });
}

async function main(): Promise<void> {
  await Promise.all(FONT_LOADS.map(([font, text]) => document.fonts.load(font, text)));

  const canvas = composePromoTile();
  document.body.appendChild(canvas);

  const status = document.createElement("p");
  document.body.appendChild(status);

  const save = document.createElement("button");
  save.textContent = "apps/extension/store/promo-tile-440x280.png に書き出す";
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
