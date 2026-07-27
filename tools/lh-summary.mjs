/**
 * `.lighthouseci/` に落ちた LHR から主要指標の中央値だけを出す。
 *
 * lhci autorun は assertion に落ちた項目しか表示しないので、緑のときの実測値が
 * 記録に残らない。しきい値を校正するにも退行の兆しを見るにも数字が要る
 * (セッション12 で `slow` のしきい値を決めるのに困った)。
 *
 *   node tools/lh-summary.mjs [dir]   既定 .lighthouseci
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? ".lighthouseci";

const METRICS = [
  ["perf", (r) => Math.round(r.categories.performance.score * 100)],
  ["FCP", (r) => Math.round(r.audits["first-contentful-paint"].numericValue)],
  ["LCP", (r) => Math.round(r.audits["largest-contentful-paint"].numericValue)],
  ["TBT", (r) => Math.round(r.audits["total-blocking-time"].numericValue)],
  ["CLS", (r) => Number(r.audits["cumulative-layout-shift"].numericValue.toFixed(4))],
  ["TTFB", (r) => Math.round(r.audits["server-response-time"].numericValue)],
  ["blocking", (r) => (r.audits["render-blocking-resources"].details?.items ?? []).length],
];

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

let reports;
try {
  reports = readdirSync(dir)
    .filter((f) => f.startsWith("lhr-") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
} catch {
  console.log(`lh-summary: ${dir} が読めないので何も出さない`);
  process.exit(0);
}

if (reports.length === 0) {
  console.log(`lh-summary: ${dir} に LHR が無い`);
  process.exit(0);
}

// URL ごとに分けて出す。dist は staticDistDir が HTML を自動発見して複数 URL を
// 測る(いまは / と /privacy/)ので、混ぜると別ページの run が同じ配列に並んで
// 読み違える(セッション16 で TBT スパイクの切り分け中に実際に誤読した)
const byUrl = new Map();
for (const r of reports) {
  const url = r.finalDisplayedUrl;
  if (!byUrl.has(url)) byUrl.set(url, []);
  byUrl.get(url).push(r);
}

for (const [url, runs] of byUrl) {
  console.log(`lh-summary: ${url} (${runs.length} runs, median)`);
  for (const [name, pick] of METRICS) {
    const values = runs.map(pick);
    console.log(`  ${name.padEnd(9)} ${String(median(values)).padStart(7)}   [${values.join(", ")}]`);
  }
}
