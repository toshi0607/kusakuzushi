/**
 * Drives tools/harness.html frame by frame and writes deterministic gameplay
 * footage, stats, and still images.
 *
 * The harness advances on an explicit dt (never rAF) behind a virtual clock,
 * so a capture that takes minutes of wall time still produces frames exactly
 * 1/FPS apart. Reruns are byte-identical for the same grid and seed.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

const execFileAsync = promisify(execFile);
const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(TOOLS_DIR, "..");
const FRAMES_DIR = path.join(TOOLS_DIR, ".frames");
const TAKES_DIR = path.join(PROJECT_DIR, "assets", "takes");

const FPS = 60;
const DT = 1 / FPS;
const DEFAULT_SEED = 20260727;
const PROBE_LIMIT_SEC = 300;
const RECORD_LIMIT_SEC = 300;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".ttf": "font/ttf" };

async function serveTools() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
    const file = path.join(TOOLS_DIR, rel || "harness.html");
    if (!file.startsWith(TOOLS_DIR)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function chromePath() {
  const { stdout } = await execFileAsync("npx", ["hyperframes", "browser", "path"], { cwd: PROJECT_DIR });
  return stdout.trim().split("\n").pop().trim();
}

async function openHarness(port, query) {
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const params = new URLSearchParams(query);
  await page.goto(`http://127.0.0.1:${port}/harness.html?${params}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 20000 }).catch(() => {
    throw new Error(`harness never became ready. page errors:\n${errors.join("\n") || "(none)"}`);
  });
  const box = await page.evaluate(() => {
    const c = document.getElementById("stage");
    return { width: c.width, height: c.height };
  });
  await page.setViewport({ width: box.width, height: box.height, deviceScaleFactor: 1 });
  return { browser, page, box };
}

async function assertGridFile(gridFile) {
  if (!gridFile || path.basename(gridFile) !== gridFile || gridFile.includes("\\")) {
    throw new Error(`--grid must be a filename that exists in tools/: ${gridFile || "(missing)"}`);
  }
  const gridPath = path.join(TOOLS_DIR, gridFile);
  try {
    const gridStat = await stat(gridPath);
    if (!gridStat.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`grid file not found in tools/: ${gridFile}`);
  }
  return gridPath;
}

function parseNumber(value, label, { integer = false, min = -Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return number;
}

function parseSeed(value) {
  return parseNumber(value, "seed", { integer: true }) >>> 0;
}

async function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!mode || !["probe", "record", "still", "reveal"].includes(mode)) {
    throw new Error("usage: node tools/record.mjs probe|record|still|reveal --grid <file> [options]");
  }

  const options = { mode, seed: DEFAULT_SEED };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--until-clear") {
      if (options.untilClear) throw new Error("duplicate --until-clear");
      options.untilClear = true;
      continue;
    }
    if (!["--grid", "--out", "--seconds", "--hold", "--at", "--seed", "--theme", "--hud", "--lives", "--config"].includes(arg)) {
      throw new Error(`unknown option: ${arg}`);
    }
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
    const key = arg.slice(2);
    if (options[key] !== undefined && key !== "seed") throw new Error(`duplicate ${arg}`);
    options[key] = value;
  }

  if (!options.grid) throw new Error("--grid is required");
  options.seed = parseSeed(options.seed);
  await assertGridFile(options.grid);

  if (options.theme !== undefined && !["video", "site"].includes(options.theme)) {
    throw new Error(`invalid theme: ${options.theme}`);
  }
  options.theme = options.theme ?? "video";

  if (options.config !== undefined && !["video", "app"].includes(options.config)) {
    throw new Error(`invalid config: ${options.config}`);
  }
  options.config = options.config ?? "video";

  if (options.hud !== undefined && !["0", "1"].includes(options.hud)) {
    throw new Error(`invalid hud: ${options.hud}`);
  }
  options.hud = options.hud ?? "0";

  options.lives = options.lives === undefined ? 9999 : parseNumber(options.lives, "--lives", { integer: true, min: 0 });

  if (mode === "probe") {
    if (options.out || options.seconds || options.hold || options.at || options.untilClear) {
      throw new Error("probe accepts only --grid, --seed, --theme, --hud, --lives, --config");
    }
  } else if (mode === "still") {
    if (options.at === undefined || !options.out) throw new Error("still requires --grid, --at, and --out");
    if (options.seconds || options.hold || options.untilClear) {
      throw new Error("still accepts --at, not --seconds, --hold, or --until-clear");
    }
    options.at = parseNumber(options.at, "--at", { min: 0 });
  } else if (mode === "reveal") {
    if (!options.out || options.seconds === undefined) throw new Error("reveal requires --grid, --out, and --seconds");
    if (options.hold !== undefined || options.at !== undefined || options.untilClear) {
      throw new Error("reveal accepts --seconds, not --hold, --at, or --until-clear");
    }
    if (path.basename(options.out) !== options.out || options.out.endsWith(".mp4") || options.out.endsWith(".stats.json")) {
      throw new Error("reveal --out must be a basename without an extension");
    }
    options.seconds = parseNumber(options.seconds, "--seconds", { min: 0 });
  } else {
    if (!options.out) throw new Error("record requires --grid and --out");
    if (path.basename(options.out) !== options.out || options.out.endsWith(".mp4") || options.out.endsWith(".stats.json")) {
      throw new Error("record --out must be a basename without an extension");
    }
    if (options.seconds !== undefined && options.untilClear) {
      throw new Error("record accepts either --seconds or --until-clear, not both");
    }
    if (options.seconds === undefined && !options.untilClear) {
      throw new Error("record requires --seconds N or --until-clear");
    }
    if (options.seconds !== undefined) options.seconds = parseNumber(options.seconds, "--seconds", { min: 0 });
    options.hold = options.hold === undefined ? 2 : parseNumber(options.hold, "--hold", { min: 0 });
    if (!options.untilClear && options.hold !== 2) throw new Error("--hold is only valid with --until-clear");
  }

  return options;
}

async function probe({ grid, seed, theme, hud, lives, config }) {
  const { server, port } = await serveTools();
  let browser;
  try {
    const opened = await openHarness(port, { grid, seed: String(seed), theme, hud, lives: String(lives), config });
    browser = opened.browser;
    const { page, box } = opened;
    console.log(`canvas ${box.width}x${box.height}`);

    const timeline = await page.evaluate(
      async (dt, limitFrames) => {
        const samples = [];
        let clearedAt = null;
        let gameOverAt = null;
        let maxBalls = 0;
        let ballLostEpisodes = 0;
        let wasBallLost = false;
        for (let i = 0; i < limitFrames; i += 1) {
          window.__advance(dt);
          const s = window.__stats();
          if (s.balls > maxBalls) maxBalls = s.balls;
          if (s.state === "ballLost") {
            if (!wasBallLost) ballLostEpisodes += 1;
            wasBallLost = true;
          } else {
            wasBallLost = false;
          }
          if (i % 30 === 0) samples.push({ t: +(i * dt).toFixed(2), ...s });
          if (s.aliveBricks === 0) {
            clearedAt = i * dt;
            break;
          }
          if (s.state === "gameOver") {
            gameOverAt = i * dt;
            break;
          }
        }
        return { samples, clearedAt, gameOverAt, maxBalls, ballLostEpisodes, final: window.__stats() };
      },
      DT,
      Math.round(PROBE_LIMIT_SEC * FPS),
    );

    const { samples, clearedAt, gameOverAt, maxBalls, ballLostEpisodes, final } = timeline;
    console.log(`total: ${final.totalContributions} contributions across ${final.totalBricks} bricks`);
    for (const sample of samples.filter((_, index) => index % 10 === 0)) {
      console.log(`  t=${String(sample.t).padStart(6)}s  remaining=${String(sample.remaining).padStart(5)}  bricks=${String(sample.aliveBricks).padStart(4)}  balls=${sample.balls}`);
    }
    if (clearedAt !== null) {
      console.log(`cleared at ${clearedAt.toFixed(2)}s`);
    } else if (gameOverAt !== null) {
      console.log(`no clear (gameOver at ${gameOverAt.toFixed(2)}s)`);
    } else {
      console.log(`NOT cleared within ${PROBE_LIMIT_SEC}s (state=${final.state})`);
    }
    console.log(`max balls: ${maxBalls}`);
    console.log(`ballLost episodes: ${ballLostEpisodes}`);
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

function makeFrameStats(frame, stats) {
  return {
    frame,
    t: +(frame * DT).toFixed(4),
    remaining: stats.remaining,
    aliveBricks: stats.aliveBricks,
    balls: stats.balls,
    state: stats.state,
  };
}

async function record({ grid, seed, out, seconds, untilClear, hold, theme, hud, lives, config }) {
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });
  await mkdir(TAKES_DIR, { recursive: true });

  const outMp4 = path.join(TAKES_DIR, `${out}.mp4`);
  const statsJson = path.join(TAKES_DIR, `${out}.stats.json`);
  const { server, port } = await serveTools();
  let browser;
  let completed = false;

  try {
    const opened = await openHarness(port, { grid, seed: String(seed), theme, hud, lives: String(lives), config });
    browser = opened.browser;
    const { page, box } = opened;
    const maxFrames = untilClear ? Math.round(RECORD_LIMIT_SEC * FPS) : Math.round(seconds * FPS);
    const holdFrames = Math.round(hold * FPS);
    const stats = [];
    const hits = [];
    let finalStats = null;
    let clearedAt = null;
    let clearFrame = null;

    console.log(untilClear
      ? `recording until clear at ${FPS}fps (cap ${RECORD_LIMIT_SEC}s before hold) — ${box.width}x${box.height}`
      : `recording ${maxFrames} frames at ${FPS}fps (${seconds}s) — ${box.width}x${box.height}`);

    for (let frame = 0; ; frame += 1) {
      if (clearFrame === null && frame >= maxFrames) break;
      if (clearFrame !== null && frame > clearFrame + holdFrames) break;

      const current = await page.evaluate(
        (dt) => {
          window.__advance(dt);
          return window.__stats();
        },
        DT,
      );
      finalStats = current;
      stats.push(makeFrameStats(frame, current));
      for (const hit of current.hits ?? []) hits.push({ t: frame * DT, frame, ...hit });
      await page.screenshot({ path: path.join(FRAMES_DIR, `f${String(frame).padStart(5, "0")}.png`), optimizeForSpeed: true });

      if (untilClear && clearFrame === null && current.aliveBricks === 0) {
        clearFrame = frame;
        clearedAt = frame * DT;
      }
      if (!untilClear && frame % 300 === 0) {
        console.log(`  frame ${frame}/${maxFrames} remaining=${current.remaining} bricks=${current.aliveBricks} balls=${current.balls}`);
      }
      if (untilClear && frame % 300 === 0) {
        console.log(`  frame ${frame} remaining=${current.remaining} bricks=${current.aliveBricks} balls=${current.balls}`);
      }
      if (untilClear && clearFrame !== null && frame >= clearFrame + holdFrames) break;
    }

    if (untilClear && clearFrame === null) {
      throw new Error(`board did not clear within ${RECORD_LIMIT_SEC}s; partial frames removed and no output written`);
    }
    if (!finalStats) throw new Error("record produced no frames");

    await writeFile(statsJson, JSON.stringify({
      fps: FPS,
      width: box.width,
      height: box.height,
      totalContributions: finalStats.totalContributions,
      totalBricks: finalStats.totalBricks,
      life: finalStats.life,
      clearedAt: untilClear ? clearedAt : null,
      frames: stats,
      hits,
    }, null, 2));
    console.log(`stats → ${statsJson}`);

    await execFileAsync("ffmpeg", [
      "-y", "-framerate", String(FPS),
      "-i", path.join(FRAMES_DIR, "f%05d.png"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "16",
      "-pix_fmt", "yuv420p", "-an",
      outMp4,
    ]);
    console.log(`video → ${outMp4}`);
    completed = true;
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    await rm(FRAMES_DIR, { recursive: true, force: true });
    if (!completed) console.error("record cleanup: removed tools/.frames");
  }
}

async function reveal({ grid, seed, out, seconds, theme, hud, lives, config }) {
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });
  await mkdir(TAKES_DIR, { recursive: true });

  const outMp4 = path.join(TAKES_DIR, `${out}.mp4`);
  const { server, port } = await serveTools();
  let browser;
  let completed = false;

  try {
    const opened = await openHarness(port, { grid, seed: String(seed), theme, hud, lives: String(lives), config });
    browser = opened.browser;
    const { page, box } = opened;
    const frames = Math.round(seconds * FPS);

    console.log(`recording ${frames} frames at ${FPS}fps (${seconds}s reveal) — ${box.width}x${box.height}`);

    for (let frame = 0; frame < frames; frame += 1) {
      const reveal = Math.min((frame / 60) / 0.7, 1);
      await page.evaluate((r) => window.__drawReveal(r), reveal);
      await page.screenshot({ path: path.join(FRAMES_DIR, `f${String(frame).padStart(5, "0")}.png`), optimizeForSpeed: true });
    }

    if (frames === 0) throw new Error("reveal produced no frames");

    await execFileAsync("ffmpeg", [
      "-y", "-framerate", String(FPS),
      "-i", path.join(FRAMES_DIR, "f%05d.png"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "16",
      "-pix_fmt", "yuv420p", "-an",
      outMp4,
    ]);
    console.log(`video → ${outMp4}`);
    completed = true;
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    await rm(FRAMES_DIR, { recursive: true, force: true });
    if (!completed) console.error("reveal cleanup: removed tools/.frames");
  }
}

/** Advance to `seconds` without intermediate screenshots, then write one frame. */
async function still({ grid, seed, seconds, out, theme, hud, lives, config }) {
  const { server, port } = await serveTools();
  let browser;
  try {
    const opened = await openHarness(port, { grid, seed: String(seed), theme, hud, lives: String(lives), config });
    browser = opened.browser;
    const { page } = opened;
    const stats = await page.evaluate(
      (dt, frames) => {
        for (let i = 0; i < frames; i += 1) window.__advance(dt);
        return window.__stats();
      },
      DT,
      Math.round(seconds * FPS),
    );

    const output = path.resolve(PROJECT_DIR, out);
    await mkdir(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    console.log(`t=${seconds}s state=${stats.state} remaining=${stats.remaining} balls=${stats.balls} → ${output}`);
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

async function main() {
  const options = await parseArgs(process.argv.slice(2));
  if (options.mode === "probe") await probe(options);
  else if (options.mode === "record") await record(options);
  else if (options.mode === "reveal") await reveal(options);
  else await still({ ...options, seconds: options.at, out: options.out });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
