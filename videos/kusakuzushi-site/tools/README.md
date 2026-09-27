# Gameplay recording harness

This directory contains a deterministic, frame-stepped kusakuzushi harness.
The recorder advances the game at 60 FPS without `requestAnimationFrame`.

Bundle the core before probing or recording:
```bash
npx --yes esbuild@0.25.10 ../../packages/core/src/index.ts --bundle \
  --format=esm --outfile=tools/core-bundle.js --log-level=warning
```

Probe a grid without writing files:
```bash
node tools/record.mjs probe --grid grid-a.json --seed 20260727
```

Record a fixed duration, or record through clear plus a hold:
```bash
node tools/record.mjs record --grid grid-a.json --out take-a --seconds 10
node tools/record.mjs record --grid grid-a.json --out take-a --until-clear --hold 2
```

Write one still after advancing to a simulated time:
```bash
node tools/record.mjs still --grid grid-a.json --at 0 \
  --out assets/takes/take-a-intact.png --seed 20260727
```

Record the grass reveal without advancing the game:
```bash
node tools/record.mjs reveal --grid grid-a.json --out take-a-reveal --seconds 1.2
```

All four subcommands (`probe`, `record`, `still`, `reveal`) also accept theme,
HUD, lives, and engine config options:
```bash
node tools/record.mjs record --grid grid-a.json --out take-site --until-clear \
  --seed 20 --theme site --hud 1 --lives 3 --config app
```
`--theme video|site` defaults to `video`; `site` is exactly the live app's dark
theme with the DotGothic16 HUD font and marquee-amber accent ball. `--hud 0|1`
defaults to `0` and draws the SCORE/LIFE HUD when enabled. `--lives N` defaults to `9999`;
use a small value such as `3` with `--hud 1` because the HUD draws one spare
ball sprite per life. `--config video|app` defaults to `video` (capture-only
ball speed 620 and faster item drops); `app` uses the engine's `DEFAULT_CONFIG`,
the same settings the web app itself plays with.
The seed above is illustrative; production site-themed seeds are chosen
separately in `record-takes.sh`.

`grid-b.json` is synthetic sparse filler preserving grid-a's 371 dates; it is
generated deterministically by `make-sparse-grid.mjs`:
```bash
node tools/make-sparse-grid.mjs
```

Run the complete bundle, both recordings, and stills with:
```bash
bash tools/record-takes.sh
```

The wrapper writes takes/stats under `assets/takes/` and removes PNG frames after each mux.

## Rebuilding the shipped cut

`renders/s10-screen.mp4` (the web-version promo) is rebuilt in this order:

```bash
bash tools/fetch-fonts.sh                     # OFL fonts from google/fonts (not committed)
bash tools/record-takes.sh                    # takes, stills, and the grass reveal
npx hyperframes capture https://kusakuzushi.toshi0607.com/ -o ./capture   # site-top still
# in another shell, from the repo root on main: pnpm --filter @kusakuzushi/web dev
node tools/capture-site.mjs                   # real app screens → assets/clips/site/
bash tools/build-clips.sh                     # every clip the compositions read
npm run render -- -c compositions/s10-screen.html -q delivery -o renders/s10-screen.mp4
```

`grid-a.json` is the 2026-09-26 snapshot of the live data, and `capture-site.mjs`
serves it to the app in place of the live API, so the takes and the captured
screens always agree. `npx hyperframes capture` records the live site as it is on
the day it runs.
