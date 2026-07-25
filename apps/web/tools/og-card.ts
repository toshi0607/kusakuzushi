/**
 * トップページ用 OGP 画像(`apps/web/public/og.png`)のジェネレータ。
 *
 * 実行時生成ではなく「生成済み PNG をコミットして Pages で配信する」方式に
 * している。トップ URL は最も貼られる URL なので、表示のたびに satori や
 * Google Fonts に依存させたくない(share カードは動的 = Worker 側の担当)。
 *
 * 再生成手順:
 *   1. pnpm --filter @kusakuzushi/web dev
 *   2. http://localhost:5173/tools/og-card.html を開く(canvas が描かれる)
 *   3. 「public/og.png に書き出す」ボタンを押す(dev 専用エンドポイントが
 *      apps/web/public/og.png を直接上書きする — vite.config.ts の card-writer 参照)
 *
 * 盤面はアトラクト画面そのもの(buildDemoGrid + core の render)を使う。
 * 草に描くワードマークを独自に描き直さないための制約(lessons.md 2026-07-25)。
 * 余白のノイズ草は Math.random なので再生成のたびに微妙に変わる — 装飾なので
 * 差分が出ること自体は問題ない。
 */

import type { ContributionGrid } from "@kusakuzushi/core";
import { DEFAULT_CONFIG, Game, computeLayout, render } from "@kusakuzushi/core";

import { buildDemoGrid } from "../src/demo-grid";
import { BODY_FONT, DISPLAY_FONT, SHARE_COLORS } from "../src/share";
import { WEB_DARK_THEME } from "../src/theme";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

const BOARD_WIDTH = 1000;
const BOARD_X = (CARD_WIDTH - BOARD_WIDTH) / 2;
const BOARD_Y = 72;
const BOARD_RADIUS = 12;

/** 草の下端とボールの上に残す余白(盤面の元解像度基準)。 */
const GRASS_BOTTOM_PADDING = 28;
const BALL_TOP_PADDING = 8;

const TITLE_SIZE = 60;
const TAGLINE_SIZE = 26;
const TITLE_GAP = 42;
const TAGLINE_GAP = 12;

const TAGLINE = "GitHub の草を、ブロック崩しで刈り取ろう";
const SITE_LABEL = "kusakuzushi.toshi0607.com";

/** アトラクト画面と同じ盤面(ワードマーク + パドル + ボール)を 1 フレーム描く。 */
function renderBoard(grid: ContributionGrid): HTMLCanvasElement {
  const board = document.createElement("canvas");
  board.width = DEFAULT_CONFIG.canvasWidth;
  board.height = DEFAULT_CONFIG.canvasHeight;
  const ctx = board.getContext("2d");
  if (!ctx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }

  // ready 状態のまま描く: ボールはパドルの上に乗り、草は 1 セルも欠けていない
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
 * 盤面は 2:1(草は上半分、パドルは下端)で、その間に約 190px の空白がある。
 * カードでは無駄なので、空白帯だけを切り落として上下 2 スライスを詰めて描く。
 * 切る帯は単色(theme.colors[0])なので継ぎ目は出ない。境界値は core の
 * computeLayout から導出し、盤面ジオメトリが変わっても追従させる。
 */
function computeBoardSlices(grid: ContributionGrid): BoardSlices {
  const layout = computeLayout(DEFAULT_CONFIG, grid.weeks.length);
  const grassHeight = layout.brickAreaTop + layout.brickAreaHeight + GRASS_BOTTOM_PADDING;
  const paddleTop = layout.paddleY - DEFAULT_CONFIG.ballRadius * 2 - BALL_TOP_PADDING;

  return {
    grassHeight,
    paddleTop,
    paddleHeight: DEFAULT_CONFIG.canvasHeight - paddleTop,
  };
}

/** トップページ用 OGP カード(1200x630)を合成する。 */
export function composeOgCard(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }

  ctx.fillStyle = SHARE_COLORS.soil;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const grid = buildDemoGrid();
  const board = renderBoard(grid);
  const slices = computeBoardSlices(grid);
  const scale = BOARD_WIDTH / board.width;
  const grassHeight = Math.round(slices.grassHeight * scale);
  const paddleHeight = Math.round(slices.paddleHeight * scale);
  const boardHeight = grassHeight + paddleHeight;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(BOARD_X, BOARD_Y, BOARD_WIDTH, boardHeight, BOARD_RADIUS);
  ctx.clip();
  ctx.drawImage(board, 0, 0, board.width, slices.grassHeight, BOARD_X, BOARD_Y, BOARD_WIDTH, grassHeight);
  ctx.drawImage(
    board,
    0,
    slices.paddleTop,
    board.width,
    slices.paddleHeight,
    BOARD_X,
    BOARD_Y + grassHeight,
    BOARD_WIDTH,
    paddleHeight,
  );
  ctx.restore();

  ctx.strokeStyle = SHARE_COLORS.ridge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(BOARD_X, BOARD_Y, BOARD_WIDTH, boardHeight, BOARD_RADIUS);
  ctx.stroke();

  const titleTop = BOARD_Y + boardHeight + TITLE_GAP;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.fillStyle = SHARE_COLORS.marquee;
  ctx.font = `${TITLE_SIZE}px ${DISPLAY_FONT}`;
  ctx.fillText("草崩し", BOARD_X, titleTop);

  const taglineTop = titleTop + TITLE_SIZE + TAGLINE_GAP;
  ctx.fillStyle = SHARE_COLORS.faint;
  ctx.font = `${TAGLINE_SIZE}px ${BODY_FONT}`;
  ctx.fillText(TAGLINE, BOARD_X, taglineTop);

  ctx.textAlign = "right";
  ctx.fillText(SITE_LABEL, BOARD_X + BOARD_WIDTH, taglineTop);
  ctx.textAlign = "left";

  return canvas;
}
