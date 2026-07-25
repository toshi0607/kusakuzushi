/** Result-screen sharing: the X post intent link and the canvas-image save/share flow. */

const SITE_URL = "https://kusakuzushi.toshi0607.com";

/**
 * The canonical share URL for `username`'s result. Served by the OGP Worker
 * (`workers/ogp`): crawlers get OGP-tagged HTML whose image reflects the
 * score/percentage carried in `s`/`p`, humans get redirected to the app.
 */
export function buildShareUrl(username: string, percentage: number, score: number): string {
  const params = new URLSearchParams({ s: String(score), p: String(percentage) });
  return `${SITE_URL}/share/${encodeURIComponent(username)}?${params.toString()}`;
}

/** Builds an `x.com/intent/post` URL announcing `username`'s harvest result. */
export function buildIntentUrl(username: string, totalContributions: number, percentage: number, score: number): string {
  const text = `${username} の草 ${totalContributions.toLocaleString("en-US")} contributions を ${percentage}% 刈り取った🌱 スコア ${score.toLocaleString("en-US")} #草崩し`;
  const params = new URLSearchParams({ text, url: buildShareUrl(username, percentage, score) });
  return `https://x.com/intent/post?${params.toString()}`;
}

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
};

/**
 * 共有画像は閲覧者のテーマに関係なく常に「夜の畑」で合成する
 * (タイムライン上で見た目が揺れないようにするブランド判断)。
 */
const SHARE_COLORS = {
  soil: "#0c110d",
  ridge: "#28332a",
  ink: "#e4ede2",
  faint: "#8da08c",
  marquee: "#ffb224",
} as const;

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 630;
const DISPLAY_FONT = '"DotGothic16", "IBM Plex Sans JP", sans-serif';
const BODY_FONT = '"IBM Plex Sans JP", sans-serif';

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

  const boardWidth = 880;
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

  const textTop = boardY + boardHeight + 44;
  ctx.textBaseline = "top";

  ctx.fillStyle = SHARE_COLORS.faint;
  ctx.font = `26px ${BODY_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`@${username}${result.cleared ? " ― 完全刈り取り!" : ""}`, boardX, textTop);

  ctx.fillStyle = SHARE_COLORS.ink;
  ctx.font = `40px ${DISPLAY_FONT}`;
  ctx.fillText(`スコア ${result.score.toLocaleString()} / 刈り取り率 ${result.percentage}%`, boardX, textTop + 40);

  ctx.fillStyle = SHARE_COLORS.marquee;
  ctx.font = `36px ${DISPLAY_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("草崩し", boardX + boardWidth, textTop + 44);
  ctx.textAlign = "left";

  return canvas;
}

/** リザルトカードを合成して保存/共有する(リザルト画面の「画像を保存」)。 */
export async function saveResultImage(source: HTMLCanvasElement, username: string, result: ShareResult): Promise<void> {
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
