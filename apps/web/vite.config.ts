import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const OG_CARD_SAVE_PATH = "/__save-og-card";
const OG_CARD_OUTPUT = fileURLToPath(new URL("./public/og.png", import.meta.url));

/**
 * dev 専用エンドポイント。`tools/og-card.html` が合成した PNG を POST すると
 * `public/og.png` に書き出す。ブラウザのダウンロードを経由せずに生成物を
 * リポジトリへ落とせるので、OGP 画像の再生成が「開いてボタンを押す」だけで済む。
 */
function ogCardWriter(): Plugin {
  return {
    name: "kusakuzushi:og-card-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(OG_CARD_SAVE_PATH, (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("POST only");
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          try {
            mkdirSync(dirname(OG_CARD_OUTPUT), { recursive: true });
            writeFileSync(OG_CARD_OUTPUT, Buffer.concat(chunks));
            response.statusCode = 200;
            response.end(OG_CARD_OUTPUT);
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error));
          }
        });
      });
    },
  };
}

/**
 * ビルド後の `<link rel="stylesheet">` を `<style>` にたたみ込む。
 *
 * 自前 CSS は 5KB(gzip 1.6KB)しかないが、これがページで唯一残った
 * render-blocking リソースで、First Paint の手前に「同一オリジンへの往復 1 回」を
 * 足していた。localhost 配信ではその往復がほぼ 0ms なので `pnpm lh` では
 * 損失が見えず、実オリジン(TTFB 170ms)でだけ効いてくる。
 *
 * 新規依存は入れない: Vite が生成したバンドルを直接書き換えるだけの
 * 20 行程度のプラグインで足りる(vite-plugin-* を追加しない理由)。
 * CSS が大きくなったら(目安 15KB 超)HTML の肥大のほうが高くつくので、
 * そのときは外部ファイルに戻すこと。
 */
function inlineStylesheet(): Plugin {
  return {
    name: "kusakuzushi:inline-stylesheet",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) {
          return html;
        }
        return html.replace(
          /<link[^>]+rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/g,
          (tag, fileName: string) => {
            const asset = bundle[fileName];
            if (!asset || asset.type !== "asset" || typeof asset.source !== "string") {
              return tag;
            }
            // インライン化したら実体は要らない(dist に孤児ファイルを残さない)
            delete bundle[fileName];
            return `<style>${asset.source}</style>`;
          },
        );
      },
    },
  };
}

export default defineConfig({
  plugins: [ogCardWriter(), inlineStylesheet()],
});
