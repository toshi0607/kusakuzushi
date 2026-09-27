/**
 * Writes assets/clips/counters.json: the measured counter series (harvest rate,
 * harvested contributions, remaining bricks, balls) for every clip the S1–S5
 * compositions show, sampled every 0.1s of output time, plus the first hit
 * that S5 zooms into. The compositions inline these numbers; this file is the
 * record of where they came from.
 *
 *   node tools/counters.mjs   (after tools/record-takes.sh)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { toGrid } = await import(pathToFileURL(path.join(PROJECT, "tools/core-bundle.js")).href);

const readJson = (rel) => JSON.parse(readFileSync(path.join(PROJECT, rel), "utf8"));
const A = readJson("assets/takes/take-a.stats.json");
const B = readJson("assets/takes/take-b.stats.json");

const at = (stats, t) => stats.frames[Math.min(stats.frames.length - 1, Math.max(0, Math.round(t * 60)))];
// Output time u → take time for the a-ramp family (see tools/build-clips.sh):
// the first 26s at 6.5x, then 1.346667x.
const ramp = (u, t0 = 0) => (u < (26 - t0) / 6.5 ? t0 + u * 6.5 : 26 + (u - (26 - t0) / 6.5) * 1.346667);

function series(stats, duration, map) {
  const out = [];
  for (let i = 0; i <= Math.round(duration * 10); i++) {
    const f = at(stats, map(i / 10));
    out.push({
      u: +(i / 10).toFixed(1),
      remaining: f.remaining,
      harvested: stats.totalContributions - f.remaining,
      pct: Math.floor((1 - f.remaining / stats.totalContributions) * 100),
      bricks: f.aliveBricks,
      balls: f.balls,
    });
  }
  return out;
}

const grid = toGrid("toshi0607", readJson("tools/grid-a.json").contributions);
const firstHit = A.hits[0];
const cell = grid.weeks?.[firstHit.col]?.[firstHit.row] ?? null;

const out = {
  takeA: { totalContributions: A.totalContributions, totalBricks: A.totalBricks, clearedAt: A.clearedAt },
  takeB: { totalContributions: B.totalContributions, totalBricks: B.totalBricks, clearedAt: B.clearedAt },
  raceFactor: 5.46,
  firstHit: { ...firstHit, cell },
  "a-ramp": series(A, 10.0, (u) => ramp(u)),
  "a-ramp-fromhit": series(A, 9.9, (u) => ramp(u, 0.77)),
  "a-race": series(A, 6.2, (u) => u * 5.46),
  "b-race": series(B, 12.4, (u) => u * 5.46),
};
writeFileSync(path.join(PROJECT, "assets/clips/counters.json"), JSON.stringify(out));
console.log(`counters → assets/clips/counters.json (first hit ${cell?.date ?? "?"})`);
