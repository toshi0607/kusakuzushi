import "./style.css";

import { initApp } from "./app";

// canvas の HUD(ctx.font)は CSS と違い、フォントが未ロードだと黙って
// フォールバック描画になる。先にロードを蹴っておき、以後のフレームで
// DotGothic16 に切り替わるようにする(2026-07-25 本番で実測済みの手順)。
if ("fonts" in document) {
  document.fonts.load('16px "DotGothic16"').catch(() => {});
}

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app root element not found");
}

initApp(root);
