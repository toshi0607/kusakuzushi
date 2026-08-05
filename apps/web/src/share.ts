/**
 * Result-screen sharing: the canvas-image save/share flow.
 *
 * 投稿文と共有 URL の組み立ては拡張と共有するため core にある
 * (`packages/core/src/share-link.ts`)。ここに残るのは web だけが持つ
 * 「盤面を焼いたリザルトカード」の合成。
 */

import { MARQUEE_COLOR } from "@kusakuzushi/core";

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("画像の生成に失敗しました"));
      }
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ShareResult = {
  score: number;
  percentage: number;
  cleared: boolean;
  /**
   * The clear screen's taunt, or null when the round ended in a gameOver.
   * Passed in rather than derived here so the card always prints the exact
   * line the player just read on the panel.
   */
  taunt: string | null;
};

/**
 * 共有画像は閲覧者のテーマに関係なく常に「夜の畑」で合成する
 * (タイムライン上で見た目が揺れないようにするブランド判断)。
 */
export const SHARE_COLORS = {
  soil: "#0c110d",
  ridge: "#28332a",
  ink: "#e4ede2",
  faint: "#8da08c",
  marquee: MARQUEE_COLOR,
} as const;

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 630;
/** 最長 30 字(§6)が盤面幅 1080px に 1 行で収まる上限。 */
const TAUNT_FONT_SIZE = 34;
export const DISPLAY_FONT = '"DotGothic16", "IBM Plex Sans JP", sans-serif';
export const BODY_FONT = '"IBM Plex Sans JP", sans-serif';

/**
 * ゲーム canvas の最終盤面を 1200x630(OGP 比)のリザルトカードに合成する。
 * 盤面スナップショット + @username + 成績 + ワードマーク。
 */
export function composeResultImage(source: HTMLCanvasElement, username: string, result: ShareResult): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }

  ctx.fillStyle = SHARE_COLORS.soil;
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);

  // 盤面は 8:3。880 幅だとカード下部に 130px の空白が残るので、左右 60px の
  // 余白まで広げて縦の重心を戻す(1080 x 405 + 見出し行で 630 をほぼ使い切る)。
  const boardWidth = 1080;
  const boardHeight = Math.round((boardWidth * source.height) / source.width);
  const boardX = (SHARE_WIDTH - boardWidth) / 2;
  const boardY = 44;

  if (typeof ctx.roundRect === "function") {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(boardX, boardY, boardWidth, boardHeight, 12);
    ctx.clip();
    ctx.drawImage(source, boardX, boardY, boardWidth, boardHeight);
    ctx.restore();
    ctx.strokeStyle = SHARE_COLORS.ridge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boardX, boardY, boardWidth, boardHeight, 12);
    ctx.stroke();
  } else {
    ctx.drawImage(source, boardX, boardY, boardWidth, boardHeight);
  }

  // 煽り文は盤面の**中**へ置く。クリアとは全ブロックを壊すことなので、この
  // スナップショットは 6 割が空白 — その空白こそが「更地になった」という絵
  // なのだから、文をそこに置けば「草があった場所」を文が占める(§8)。
  // 34px なら最長 30 字が 1020px、盤面幅 1080px に左右 30px 残して 1 行。
  if (result.taunt) {
    ctx.fillStyle = SHARE_COLORS.ink;
    ctx.font = `${TAUNT_FONT_SIZE}px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 残骸の行(盤面上部)とパドル(下端)の間。中央よりわずかに下。
    ctx.fillText(result.taunt, boardX + boardWidth / 2, boardY + boardHeight * 0.56);
  }

  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let y = boardY + boardHeight + 40;

  ctx.fillStyle = SHARE_COLORS.faint;
  ctx.font = `24px ${BODY_FONT}`;
  ctx.fillText(`@${username}${result.cleared ? " ― 完全刈り取り" : ""}`, boardX, y);
  y += 34;

  ctx.fillStyle = SHARE_COLORS.ink;
  ctx.font = `40px ${DISPLAY_FONT}`;
  ctx.fillText(`スコア ${result.score.toLocaleString()} / 刈り取り率 ${result.percentage}%`, boardX, y);

  ctx.fillStyle = SHARE_COLORS.marquee;
  ctx.font = `36px ${DISPLAY_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("草崩し", boardX + boardWidth, y);
  ctx.textAlign = "left";

  return canvas;
}

/**
 * カードが描く文字ぶんのグリフを先に読み込ませる。
 *
 * Google Fonts の DotGothic16 は unicode-range でサブセット分割されており、
 * 画面に出ていない字のサブセットはまだ取得されていない。canvas は未読込の
 * 字を**黙って別の書体にフォールバックして描く**(エラーにならない)ので、
 * 合成前に明示的に要求しておかないと、煽り文だけ丸ゴシックで焼き付いた
 * 画像が保存されうる(2026-07-26 に実物で確認)。
 */
async function loadCardGlyphs(texts: readonly string[]): Promise<void> {
  if (!document.fonts?.load) return;
  const text = texts.join("");
  try {
    await Promise.all([document.fonts.load(`34px ${DISPLAY_FONT}`, text), document.fonts.load(`24px ${BODY_FONT}`, text)]);
  } catch {
    // 取得に失敗しても、フォールバック書体で描いたカードのほうが無いよりよい
  }
}

/** リザルトカードを合成して保存/共有する(リザルト画面の「画像を保存」)。 */
export async function saveResultImage(source: HTMLCanvasElement, username: string, result: ShareResult): Promise<void> {
  await loadCardGlyphs([
    `@${username} ― 完全刈り取り`,
    `スコア ${result.score.toLocaleString()} / 刈り取り率 ${result.percentage}%`,
    "草崩し",
    result.taunt ?? "",
  ]);
  await saveCanvasImage(composeResultImage(source, username, result), username);
}

/**
 * Saves a snapshot of `canvas` as `kusakuzushi-{username}.png`. Uses the Web
 * Share API when the platform can share files (mobile Safari/Chrome), and
 * falls back to a plain download link otherwise.
 */
export async function saveCanvasImage(canvas: HTMLCanvasElement, username: string): Promise<void> {
  const blob = await canvasToBlob(canvas);
  const fileName = `kusakuzushi-${username}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      // Sharing failed for a non-cancellation reason — fall back to download.
    }
  }

  downloadBlob(blob, fileName);
}
