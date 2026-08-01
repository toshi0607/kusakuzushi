/**
 * Re-shoots the four Chrome Web Store screenshots against the current build.
 *
 * The page is the real GitHub profile (so the grass is real GitHub markup),
 * stripped down to the contributions section only: everything that is not an
 * ancestor of the calendar table or of its heading is hidden, which removes the
 * profile sidebar (employer), the pinned repositories and the activity feed.
 *
 * The viewport is 915x572 at a 1.4x device scale factor, which is what makes a
 * 1280x800 store screenshot with the same cell size as the existing set.
 */
import { readFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

// puppeteer-core is not a declared dependency anywhere in the workspace — it
// arrives as a transitive dependency of @lhci/cli, which is enough for a
// once-per-release screenshot run and keeps it out of the shipped package.
const store = path.join(REPO, "node_modules/.pnpm");
const pup = (await readdir(store)).find((d) => d.startsWith("puppeteer-core@"));
if (!pup) throw new Error("puppeteer-core not found — run `pnpm install` first");
const puppeteer = (
  await import(path.join(store, pup, "node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js"))
).default;

const OUT = path.join(REPO, "apps/extension/store/screenshots");
const PROFILE = process.env.KUSAKUZUSHI_PROFILE_URL ?? "https://github.com/toshi0607";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: 915, height: 572, deviceScaleFactor: 1.4 };

const CONTENT = await readFile(path.join(REPO, "apps/extension/dist/content.js"), "utf8");
const CONTENT_ITEMS = (() => {
  const patched = CONTENT.replace("itemDropChance:.08", "itemDropChance:1").replace(
    "earlyItemDropBonus:.14",
    "earlyItemDropBonus:0",
  );
  if (patched === CONTENT) throw new Error("item-drop patch did not apply");
  return patched;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hide everything that is not on the path to the calendar table or its heading. */
function stripPage() {
  const table = document.querySelector("td.ContributionCalendar-day")?.closest("table");
  const heading = document.getElementById("js-contribution-activity-description");
  if (!table) throw new Error("calendar table not found");
  const keep = new Set();
  for (const start of [table, heading]) {
    for (let el = start; el; el = el.parentElement) keep.add(el);
  }
  for (const el of keep) {
    for (const sib of el.parentElement?.children ?? []) {
      // Primer utility classes are `!important`, so plain inline styles lose.
      if (!keep.has(sib) && sib instanceof HTMLElement) sib.style.setProperty("display", "none", "important");
    }
  }
  for (const el of document.querySelectorAll("nav, .UnderlineNav, header, footer")) {
    if (!keep.has(el) && el instanceof HTMLElement) el.style.setProperty("display", "none", "important");
  }
  const layout = table.closest(".Layout");
  if (layout instanceof HTMLElement) layout.style.display = "block";
  const main = table.closest(".Layout-main");
  if (main instanceof HTMLElement) {
    main.style.width = "100%";
    main.style.maxWidth = "none";
  }
  // The calendar is right-aligned below the xl breakpoint; centre it so the card
  // does not carry a wide blank margin on the left.
  const graph = table.closest(".js-calendar-graph");
  if (graph instanceof HTMLElement) {
    graph.style.setProperty("align-items", "center", "important");
  }
  // Kept ancestors above the heading (the profile nav wrapper) still draw their
  // own borders, which would show up as a stray rule across the top of the shot.
  const headingTop = heading.getBoundingClientRect().top;
  for (const el of keep) {
    if (el instanceof HTMLElement && el.getBoundingClientRect().top < headingTop) el.style.setProperty("border", "none", "important");
  }

  const spacer = document.createElement("div");
  spacer.id = "shot-spacer";
  document.body.prepend(spacer);
  return true;
}

/** Push the section down with the spacer until the heading sits `top` CSS px from the top. */
function frameHeading(top) {
  const spacer = document.getElementById("shot-spacer");
  const heading = document.getElementById("js-contribution-activity-description");
  spacer.style.height = "0px";
  const current = heading.getBoundingClientRect().top;
  spacer.style.height = `${Math.max(0, Math.round(top - current))}px`;
  return heading.getBoundingClientRect().top;
}

/** Centroid x of the marquee-amber pixels on the overlay, in CSS px inside the canvas. */
function ballX() {
  const canvas = [...document.querySelectorAll("canvas")].find((c) => c.style.zIndex === "100");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128 && data[i] > 235 && data[i + 1] > 150 && data[i + 1] < 205 && data[i + 2] < 80) {
      sum += (i / 4) % canvas.width;
      n += 1;
    }
  }
  if (n === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  return sum / n / dpr;
}

function canvasRect() {
  const canvas = [...document.querySelectorAll("canvas")].find((c) => c.style.zIndex === "100");
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * How many grass cells the game has knocked out. The painter only ever writes an
 * inline colour on bricks (level >= 1), so a destroyed one is a brick now wearing
 * the level-0 colour.
 */
function destroyedCount() {
  const cells = [...document.querySelectorAll("td.ContributionCalendar-day")];
  const zero = cells.find((el) => el.dataset.level === "0");
  if (!zero) return 0;
  const dead = getComputedStyle(zero).backgroundColor;
  return cells.filter((el) => el.dataset.level !== "0" && el.style.backgroundColor === dead).length;
}

async function openPage(browser, source) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.goto(PROFILE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("td.ContributionCalendar-day", { timeout: 30000 });
  await page.evaluate(stripPage);
  await page.evaluate(source);
  await sleep(1200);
  return page;
}

async function startGame(page) {
  await page.evaluate(() => document.getElementById("kusakuzushi-launch").click());
  await sleep(900);
}

/** Keep the paddle under the ball; resolves once `done(state)` says to stop. */
async function rally(page, done, { timeoutMs = 90000 } = {}) {
  await page.keyboard.press("Space");
  await sleep(200);
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < timeoutMs) {
    const [x, rect, destroyed] = await Promise.all([
      page.evaluate(ballX),
      page.evaluate(canvasRect),
      page.evaluate(destroyedCount),
    ]);
    last = destroyed;
    if (done({ destroyed, elapsed: Date.now() - started })) return { destroyed };
    if (x != null && rect) {
      const vx = Math.min(Math.max(rect.left + x, rect.left + 2), rect.left + rect.width - 2);
      await page.mouse.move(vx, rect.top + rect.height - 8);
    }
    await sleep(40);
  }
  return { destroyed: last };
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ["--window-size=960,760", "--hide-scrollbars"],
  defaultViewport: VIEWPORT,
});

try {
  const page = await openPage(browser, CONTENT);
  console.log("01 heading top:", await page.evaluate(frameHeading, 200));
  await page.screenshot({ path: path.join(OUT, "01-button.png") });

  console.log("02 heading top:", await page.evaluate(frameHeading, 164));
  await startGame(page);
  const rect = await page.evaluate(canvasRect);
  await page.mouse.move(rect.left + rect.width / 2, rect.top + rect.height - 8);
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, "02-ready.png") });

  const played = await rally(page, ({ destroyed }) => destroyed >= 60);
  console.log("03 destroyed:", played.destroyed);
  await page.screenshot({ path: path.join(OUT, "03-playing.png") });
  await page.close();

  const itemPage = await openPage(browser, CONTENT_ITEMS);
  await itemPage.evaluate(frameHeading, 164);
  await startGame(itemPage);
  const itemPlayed = await rally(itemPage, ({ destroyed }) => destroyed >= 8, { timeoutMs: 45000 });
  console.log("04 destroyed:", itemPlayed.destroyed);
  await itemPage.screenshot({ path: path.join(OUT, "04-items.png") });
  await itemPage.close();
} finally {
  await browser.close();
}
console.log("done — crop the 1281x801 output to 1280x800 with `sips -c 800 1280`");
