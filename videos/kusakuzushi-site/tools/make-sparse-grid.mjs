import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(TOOLS_DIR, "grid-a.json");
const OUTPUT = path.join(TOOLS_DIR, "grid-b.json");

let seed = 20260727;
function rng() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const raw = JSON.parse(await readFile(INPUT, "utf8"));
if (!Array.isArray(raw.contributions)) throw new Error("grid-a.json has no contributions array");

const contributions = raw.contributions.map(({ date }) => {
  if (rng() >= 0.1) return { date, count: 0, level: 0 };

  const level = rng() < 0.8 ? 1 : 2;
  const count = level === 1 ? 1 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 2);
  return { date, count, level };
});

const total = contributions.reduce((sum, cell) => sum + cell.count, 0);
const output = { total: { lastYear: total }, contributions };
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`wrote ${OUTPUT}: ${contributions.length} dates, ${total} contributions`);
