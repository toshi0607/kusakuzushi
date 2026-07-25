import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");
const dist = "dist";

const options = {
  entryPoints: ["src/content.ts"],
  outfile: path.join(dist, "content.js"),
  bundle: true,
  format: "iife",
  target: "chrome120",
  platform: "browser",
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
};

try {
  await mkdir(dist, { recursive: true });
  await copyFile("manifest.json", path.join(dist, "manifest.json"));

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
