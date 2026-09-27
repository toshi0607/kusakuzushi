/**
 * Captures the real web app's screens for the screen-recording cut
 * (compositions/s10-screen.html) into assets/clips/site/.
 *
 *   1. start the web app from main:  pnpm --filter @kusakuzushi/web dev   (http://localhost:5173)
 *   2. node tools/capture-site.mjs   (KUSAKUZUSHI_WEB_URL overrides the URL)
 *
 * 1920×1080 at deviceScaleFactor 2 (3840×2160 PNGs), dark scheme, reduced
 * motion (the attract demo then shows its static wordmark, so the typing frames
 * don't each freeze the demo at a different moment). The grid API response is
 * replaced with tools/grid-a.json — the snapshot the gameplay takes were
 * recorded from — so the page header and the board match the composited take.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(PROJECT, "assets/clips/site");
const BASE = process.env.KUSAKUZUSHI_WEB_URL ?? "http://localhost:5173/";
const USER = "toshi0607";
const GRID = readFileSync(path.join(PROJECT, "tools/grid-a.json"), "utf8");
mkdirSync(OUT, { recursive: true });

const chrome = execFileSync("npx", ["hyperframes", "browser", "path"], { cwd: PROJECT })
  .toString().trim().split("\n").pop().trim();

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([
  { name: "prefers-color-scheme", value: "dark" },
  { name: "prefers-reduced-motion", value: "reduce" },
]);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.setRequestInterception(true);
page.on("request", (req) => {
  if (req.url().includes("/api/grid/")) {
    req.respond({ status: 200, contentType: "application/json", body: GRID });
  } else {
    req.continue();
  }
});

const rect = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: r.x, y: r.y, w: r.width, h: r.height, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, cursor: cs.cursor };
  }, sel);
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("shot", name);
};
const rects = {};

await page.goto(BASE, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 1200));
const inputSel = "input";
const buttonSel = "button[type=submit], form button";
rects.form = { input: await rect(inputSel), button: await rect(buttonSel), canvas: await rect("canvas") };
await shot("form-idle");

await page.click(inputSel);
await page.mouse.move(1, 1);
await shot("type-00");
for (let i = 1; i <= USER.length; i++) {
  await page.keyboard.type(USER[i - 1]);
  await shot(`type-${String(i).padStart(2, "0")}`);
}
const b = rects.form.button;
await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
await shot("button-hover");
await page.mouse.down();
await shot("button-active");
await page.mouse.up();

await page.waitForSelector("canvas.game-canvas", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2500));
await page.mouse.move(1, 1);
rects.play = { canvas: await rect("canvas.game-canvas"), overlay: await rect(".overlay") };
rects.url = page.url();
await shot("ready");

const c = rects.play.canvas;
await page.mouse.move(c.x + c.w / 2, c.y + c.h * 0.8);
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
rects.playing = { canvas: await rect("canvas.game-canvas"), overlay: await rect(".overlay") };
await page.mouse.move(1, 1);
await shot("playing");

rects.bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
rects.errors = errors;
writeFileSync(path.join(OUT, "rects.json"), JSON.stringify(rects, null, 2));
await browser.close();
if (errors.length > 0) {
  console.error(`page errors:\n${errors.join("\n")}`);
  process.exit(1);
}
