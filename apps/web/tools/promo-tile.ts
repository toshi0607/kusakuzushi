/**
 * Chrome ウェブストアの小プロモタイル(440x280、`apps/extension/store/` へ書き出し)の
 * ジェネレータ。ストアの必須画像で、掲載ページとカテゴリ一覧に出る。
 *
 * 再生成手順:
 *   1. pnpm --filter @kusakuzushi/web dev
 *   2. http://localhost:5173/tools/promo-tile.html を開く
 *   3. 「書き出す」ボタン(dev 専用エンドポイント — vite.config.ts の card-writer 参照)
 *
 * 盤面はアトラクト画面そのもの(buildDemoGrid + core の render)を使う。og-card.ts と
 * 同じ制約: 草に描くワードマークを独自に描き直さない(lessons.md 2026-07-25)。
 *
 * 盤面の空白帯を切り落とすスライス計算は og-card.ts と同じ考え方だが、あちらは
 * 生成物(public/og.png)が確定済みで、共通化のためのリファクタは再生成を伴う。
 * 余白のノイズ草が Math.random なので「出力が変わっていないこと」を byte 比較で
 * 示せない以上、既存の生成物には触らない判断でここに独立して持つ。
 */

import type { ContributionGrid } from "@kusakuzushi/core";
import { DEFAULT_CONFIG, Game, computeLayout, render } from "@kusakuzushi/core";

import { buildDemoGrid } from "../src/demo-grid";
import { DISPLAY_FONT, SHARE_COLORS } from "../src/share";
import { WEB_DARK_THEME } from "../src/theme";

const TILE_WIDTH = 440;
const TILE_HEIGHT = 280;
const TILE_PADDING = 20;
const BOARD_RADIUS = 8;

/** 草の下端とボールの上に残す余白(盤面の元解像度基準。og-card.ts と同値)。 */
const GRASS_BOTTOM_PADDING = 28;
const BALL_TOP_PADDING = 8;

/** 盤面とタイトルの間隔、およびタイトルの字送り。 */
const TITLE_GAP = 26;
const TITLE_SIZE = 54;

const TITLE = "草崩し";

/** アトラクト画面と同じ盤面(ワードマーク + パドル + ボール)を 1 フレーム描く。 */
function renderBoard(grid: ContributionGrid): HTMLCanvasElement {
  const board = document.createElement("canvas");
  board.width = DEFAULT_CONFIG.canvasWidth;
  board.height = DEFAULT_CONFIG.canvasHeight;
  const ctx = board.getContext("2d");
  if (!ctx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }

  render(ctx, new Game(grid), WEB_DARK_THEME, { hud: false });
  return board;
}

type BoardSlices = {
  /** 上端から草の少し下まで(ワードマーク側)。 */
  grassHeight: number;
  /** ボール・パドル帯の開始 y。 */
  paddleTop: number;
  /** 盤面の下端までの高さ。 */
  paddleHeight: number;
};

/**
 * 盤面は上半分が草・下端がパドルで、間に空白帯がある。タイルでは無駄なので
 * 空白だけを切り落として上下 2 スライスを詰める。境界値は core の computeLayout から
 * 導出するので、盤面ジオメトリが変わっても追従する。
 */
function computeBoardSlices(grid: ContributionGrid): BoardSlices {
  const layout = computeLayout(DEFAULT_CONFIG, grid.weeks.length);
  const paddleTop = layout.paddleY - DEFAULT_CONFIG.ballRadius * 2 - BALL_TOP_PADDING;

  return {
    grassHeight: layout.brickAreaTop + layout.brickAreaHeight + GRASS_BOTTOM_PADDING,
    paddleTop,
    paddleHeight: DEFAULT_CONFIG.canvasHeight - paddleTop,
  };
}

/** 小プロモタイル(440x280)を合成する。 */
export function composePromoTile(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_WIDTH;
  canvas.height = TILE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }

  ctx.fillStyle = SHARE_COLORS.soil;
  ctx.fillRect(0, 0, TILE_WIDTH, TILE_HEIGHT);

  const grid = buildDemoGrid();
  const board = renderBoard(grid);
  const slices = computeBoardSlices(grid);

  // 盤面の縦横比は core のジオメトリ次第なので、幅と高さの両方に収まる倍率を選ぶ。
  // 決め打ちの倍率だと DEFAULT_CONFIG が変わった日にタイルからはみ出す。
  const availableWidth = TILE_WIDTH - TILE_PADDING * 2;
  const availableHeight = TILE_HEIGHT - TILE_PADDING * 2 - TITLE_GAP - TITLE_SIZE;
  const slicedHeight = slices.grassHeight + slices.paddleHeight;
  const scale = Math.min(availableWidth / board.width, availableHeight / slicedHeight);

  const boardWidth = Math.round(board.width * scale);
  const grassHeight = Math.round(slices.grassHeight * scale);
  const paddleHeight = Math.round(slices.paddleHeight * scale);
  const boardHeight = grassHeight + paddleHeight;
  const boardX = Math.round((TILE_WIDTH - boardWidth) / 2);

  // 盤面が幅で頭打ちになると下に空きが出るので、盤面 + タイトルをひとかたまりと
  // して上下中央に置く(高さを固定の帯で切ると、空白がタイトルの下だけに寄る)。
  const groupHeight = boardHeight + TITLE_GAP + TITLE_SIZE;
  const boardY = Math.round((TILE_HEIGHT - groupHeight) / 2);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(boardX, boardY, boardWidth, boardHeight, BOARD_RADIUS);
  ctx.clip();
  ctx.drawImage(board, 0, 0, board.width, slices.grassHeight, boardX, boardY, boardWidth, grassHeight);
  ctx.drawImage(
    board,
    0,
    slices.paddleTop,
    board.width,
    slices.paddleHeight,
    boardX,
    boardY + grassHeight,
    boardWidth,
    paddleHeight,
  );
  ctx.restore();

  ctx.strokeStyle = SHARE_COLORS.ridge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boardX + 0.5, boardY + 0.5, boardWidth - 1, boardHeight - 1, BOARD_RADIUS);
  ctx.stroke();

  // 小タイルは文字を詰め込まないほうが一覧で縮小されたときに読める
  // (ウェブストアの画像ガイドライン)。載せるのはワードマークだけ。
  ctx.fillStyle = SHARE_COLORS.marquee;
  ctx.font = `${TITLE_SIZE}px ${DISPLAY_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(TITLE, TILE_WIDTH / 2, boardY + boardHeight + TITLE_GAP + TITLE_SIZE / 2);

  return canvas;
}
