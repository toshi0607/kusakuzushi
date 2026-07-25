/**
 * Lighthouse の "slow" ターゲット用の静的サーバ。
 *
 * `pnpm lh`(lhci の staticDistDir)は localhost 配信なので RTT ≒ 0 /
 * server-response-time ≒ 20ms になる。その条件では **クリティカルパスの往復が
 * 何回あっても FCP はほぼ変わらない** ため、「First Paint が JS の実行を待っている」
 * ような劣化が 100 点のまま通り抜けてしまう(セッション12 で実際に起きた)。
 *
 * ここでは全レスポンスに一定の遅延を挟むことで、実オリジンの TTFB を持ち込む。
 * 既定 170ms は本番 https://kusakuzushi.toshi0607.com/ の
 * `server-response-time` 実測値(2026-07-25)。
 *
 * 本番 URL そのものを測る `pnpm lh:prod` と違い、外部要因(回線・Pages の機嫌)が
 * 入らないので PR ゲートとして決定的に使える。
 *
 *   node tools/lh-slow-server.mjs [root] [delayMs] [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.argv[2] ?? "apps/web/dist";
const delayMs = Number(process.argv[3] ?? 170);
const port = Number(process.argv[4] ?? 4173);

const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/vnd.microsoft.icon",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  let filePath = normalize(decodeURIComponent(pathname));
  if (filePath.endsWith("/")) {
    filePath += "index.html";
  }
  // 実オリジンの TTFB を再現する。ヘッダを書く前に待つこと(= TTFB になる)
  await sleep(delayMs);
  try {
    const absolute = join(root, filePath);
    await stat(absolute);
    const body = await readFile(absolute);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(absolute)] ?? "application/octet-stream",
      "content-length": body.length,
      // Cloudflare Pages が /assets/* に付けるのと同じ長期キャッシュ
      "cache-control": "public, max-age=31536000, immutable",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`lh-slow-server: http://localhost:${port} (root=${root}, delay=${delayMs}ms)`);
});
