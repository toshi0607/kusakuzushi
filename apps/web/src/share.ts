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
