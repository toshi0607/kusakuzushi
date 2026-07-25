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

export default defineConfig({
  plugins: [ogCardWriter()],
});
