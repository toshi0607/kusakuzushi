import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const CARD_SAVE_PATH = "/__save-card";

/**
 * 書き出し先は名前で引く固定表にする。POST のボディだけを受け取り、パスを
 * リクエストから組み立てない(dev サーバーとはいえ、任意のパスに書ける口を
 * 開けないため)。
 */
const CARD_OUTPUTS: Record<string, string> = {
  og: fileURLToPath(new URL("./public/og.png", import.meta.url)),
  "promo-tile": fileURLToPath(
    new URL("../extension/store/promo-tile-440x280.png", import.meta.url),
  ),
};

/**
 * dev 専用エンドポイント。`tools/*.html` のジェネレータが合成した PNG を
 * `?target=` 付きで POST すると、CARD_OUTPUTS の対応先に書き出す。ブラウザの
 * ダウンロードを経由せずに生成物をリポジトリへ落とせるので、画像の再生成が
 * 「開いてボタンを押す」だけで済む。
 */
function cardWriter(): Plugin {
  return {
    name: "kusakuzushi:card-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(CARD_SAVE_PATH, (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("POST only");
          return;
        }

        const target = new URL(request.url ?? "", "http://localhost").searchParams.get("target");
        const output = target === null ? undefined : CARD_OUTPUTS[target];
        if (output === undefined) {
          response.statusCode = 400;
          response.end(`unknown target: ${String(target)}`);
          return;
        }

        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          try {
            mkdirSync(dirname(output), { recursive: true });
            writeFileSync(output, Buffer.concat(chunks));
            response.statusCode = 200;
            response.end(output);
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
  plugins: [cardWriter(), inlineStylesheet()],
});
