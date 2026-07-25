import "./style.css";

import { initApp } from "./app";

// canvas の HUD(ctx.font)は CSS と違い、フォントが未ロードだと黙って
// フォールバック描画になる。先にロードを蹴っておき、以後のフレームで
// DotGothic16 に切り替わるようにする(2026-07-25 本番で実測済みの手順)。
//
// ただし DotGothic16 の CSS は非同期ロード(index.html 参照)なので、
// @font-face がまだ登録されていない状態で fonts.load を呼ぶと何もせずに解決する。
// link の load を待ってから蹴ること。
function preloadHudFont(): void {
  if (!("fonts" in document)) {
    return;
  }
  // ロード失敗は意図的に無視: HUD は sans-serif フォールバックで描画が成立する
  const load = (): void => void document.fonts.load('16px "DotGothic16"').catch(() => {});
  const link = document.querySelector<HTMLLinkElement>('link[data-font="display"]');
  if (link && !link.sheet) {
    link.addEventListener("load", load, { once: true });
    return;
  }
  load();
}

preloadHudFont();

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app root element not found");
}

initApp(root);
