import { mkdir, copyFile, cp, rm } from "node:fs/promises";
import path from "node:path";
import esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const dist = "dist";

const options = {
  // `content.js` is what manifest.json injects; `src/main.ts` is the only
  // module that mounts anything, so the rest stays side-effect-free.
  entryPoints: ["src/main.ts"],
  outfile: path.join(dist, "content.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  platform: "browser",
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
};

try {
  // dist は package.mjs がそのまま zip にする「提出物そのもの」なので、消えた
  // アイコンやロケールが前回のビルドから残らないよう毎回作り直す。
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyFile("manifest.json", path.join(dist, "manifest.json"));

  // manifest.json が参照するパスをそのまま dist に写す。欠けると Chrome が拡張の
  // 読み込み自体を拒否する(欠落アイコンも、default_locale に対応する _locales の
  // 欠落も manifest エラー扱い)。
  await cp("icons", path.join(dist, "icons"), { recursive: true });
  await cp("_locales", path.join(dist, "_locales"), { recursive: true });

  if (isWatch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("watching src/ — reload the unpacked extension after each rebuild");
  } else {
    await esbuild.build(options);
    console.log(`built ${options.outfile}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
