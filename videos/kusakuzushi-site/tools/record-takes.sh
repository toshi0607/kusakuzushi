#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> bundling the game core"
test -f ../../packages/core/src/index.ts || {
  echo "core source not found at ../../packages/core/src/index.ts" >&2
  exit 1
}
npx --yes esbuild@0.25.10 ../../packages/core/src/index.ts --bundle \
  --format=esm --outfile=tools/core-bundle.js --log-level=warning

echo "==> recording take A"
# seed 20260727 (the harness default) deterministically deadlocks on both grid-a.json and grid-b.json under these game params; direct simulation verified seed 20 clears both (grid-a ~33s, grid-b ~66s), so pin it here instead of relying on the harness default.
node tools/record.mjs record --grid grid-a.json --out take-a --until-clear --hold 2 --seed 20

echo "==> recording take B"
node tools/record.mjs record --grid grid-b.json --out take-b --until-clear --hold 2 --seed 20

echo "==> stills"
node tools/record.mjs still --grid grid-a.json --at 0 \
  --out assets/takes/take-a-intact.png --seed 20
node tools/record.mjs still --grid grid-b.json --at 0 \
  --out assets/takes/take-b-intact.png --seed 20

CLEARED=$(node -e '
const s = require("./assets/takes/take-a.stats.json");
if (typeof s.clearedAt !== "number") { console.error("take-a has no clearedAt"); process.exit(1); }
console.log(s.clearedAt);
')
EMPTY_AT=$(node -e 'const s = require("./assets/takes/take-a.stats.json"); console.log(s.clearedAt + 1.0);')
node tools/record.mjs still --grid grid-a.json --at "$EMPTY_AT" \
  --out assets/takes/take-a-empty.png --seed 20

CANVAS=$(node -e 'const s = require("./assets/takes/take-a.stats.json"); console.log(`${s.width}x${s.height}`);')
CLEARED_B=$(node -e 'const s = require("./assets/takes/take-b.stats.json"); console.log(s.clearedAt);')
echo "==> done"
echo "    canvas ${CANVAS}"
echo "    take-a cleared at ${CLEARED}s"
echo "    take-b cleared at ${CLEARED_B}s"
ls -lh \
  assets/takes/take-a.mp4 assets/takes/take-a.stats.json \
  assets/takes/take-b.mp4 assets/takes/take-b.stats.json \
  assets/takes/take-a-intact.png assets/takes/take-b-intact.png \
  assets/takes/take-a-empty.png

echo "==> recording take A-site (matches the live web app's own canvas)"
# Probe survey: grid-a.json, config=app (engine DEFAULT_CONFIG), lives=3, seeds
# 0..40, 300s cap each. Seed 8 clears in 49.28s with up to 200 simultaneous
# balls and 0 ballLost episodes — smallest clearedAt among seeds meeting
# clearedAt<=150s and maxBalls>=20 (probe survey recorded separately, not in
# this script).
node tools/record.mjs record --grid grid-a.json --out take-a-site --until-clear --hold 2 \
  --seed 8 --config app --theme site --hud 1 --lives 3

echo "==> stills for take A-site"
node tools/record.mjs still --grid grid-a.json --at 0 \
  --out assets/takes/take-a-site-intact.png --seed 8 --config app --theme site --hud 1 --lives 3

EMPTY_AT_SITE=$(node -e 'const s = require("./assets/takes/take-a-site.stats.json"); console.log(s.clearedAt + 1.0);')
node tools/record.mjs still --grid grid-a.json --at "$EMPTY_AT_SITE" \
  --out assets/takes/take-a-site-empty.png --seed 8 --config app --theme site --hud 1 --lives 3

CLEARED_SITE=$(node -e 'const s = require("./assets/takes/take-a-site.stats.json"); console.log(s.clearedAt);')
echo "    take-a-site cleared at ${CLEARED_SITE}s"
ls -lh \
  assets/takes/take-a-site.mp4 assets/takes/take-a-site.stats.json \
  assets/takes/take-a-site-intact.png assets/takes/take-a-site-empty.png

echo "==> grass reveal for take A-site (s10-screen plays it inside the real page)"
# The web app grows the grass column by column over 700ms when a session starts
# (apps/web/src/session.ts REVEAL_DURATION_MS). The reveal mode renders exactly
# that with the game held in its ready state.
node tools/record.mjs reveal --grid grid-a.json --out take-a-site-reveal --seconds 1.2 \
  --seed 8 --config app --theme site --hud 1 --lives 3
