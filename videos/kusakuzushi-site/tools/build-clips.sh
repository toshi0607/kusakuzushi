#!/usr/bin/env bash
# Rebuilds every clip and still the compositions read (assets/clips/) from the
# takes that tools/record-takes.sh records.
#
#   round 1 (S1–S9): a-ramp, a-ramp-rev, a-ramp-fromhit, a-race, b-race, a-peak
#   round 2 (S10):   c-peak, c-play, take-a-site-reveal
#   stills:          take-*-intact / take-*-empty, site-top
#
# Inputs this script does not make:
#   capture/                 npx hyperframes capture https://kusakuzushi.toshi0607.com/ -o ./capture
#   assets/clips/site/*.png  node tools/capture-site.mjs (needs the web dev server)
#
# The two rounds were encoded with different settings (crf 16 / medium, then
# crf 14 / slow). Both are kept so a rebuild reproduces the shipped inputs.
set -euo pipefail
cd "$(dirname "$0")/.."

bash tools/fetch-fonts.sh

T=assets/takes
C=assets/clips
mkdir -p "$C"
R1=(-an -c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p -r 60)
R2=(-an -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p -r 60)

echo "==> round 1"
# The take is quiet for 26s (one ball) and then explodes into multiball, so the
# ramp runs the quiet part at 6.5x (4.0s) and the finish at 1.35x (6.0s).
ffmpeg -y -loglevel error -i "$T/take-a.mp4" -filter_complex \
  "[0:v]trim=0:26,setpts=(PTS-STARTPTS)/6.5[a];[0:v]trim=26:34.0833,setpts=(PTS-STARTPTS)/1.346667[b];[a][b]concat=n=2:v=1[o]" \
  -map "[o]" "${R1[@]}" "$C/a-ramp.mp4"
# 1440x540 rather than 1080x405: libx264 needs even dimensions.
ffmpeg -y -loglevel error -i "$C/a-ramp.mp4" -vf "scale=1440:540:flags=lanczos,reverse" "${R1[@]}" "$C/a-ramp-rev.mp4"
# Same ramp, starting at the first hit (0.77s) for S5's match cut.
ffmpeg -y -loglevel error -i "$T/take-a.mp4" -filter_complex \
  "[0:v]trim=0.77:26,setpts=(PTS-STARTPTS)/6.5[a];[0:v]trim=26:34.0833,setpts=(PTS-STARTPTS)/1.346667[b];[a][b]concat=n=2:v=1[o]" \
  -map "[o]" "${R1[@]}" "$C/a-ramp-fromhit.mp4"
# S2 races both takes at the same factor, so the relative speed stays honest.
ffmpeg -y -loglevel error -i "$T/take-a.mp4" -vf "setpts=PTS/5.46" "${R1[@]}" "$C/a-race.mp4"
ffmpeg -y -loglevel error -i "$T/take-b.mp4" -vf "setpts=PTS/5.46" "${R1[@]}" "$C/b-race.mp4"
# Real speed from the start of the multiball explosion to the end of the take.
ffmpeg -y -loglevel error -ss 27.0 -i "$T/take-a.mp4" -t 7.0833 "${R1[@]}" "$C/a-peak.mp4"

echo "==> round 2"
# take-a-site plays with the web app's own config (seed 8); 43.6–46.6s is the
# 3s window with the most balls while half the board is still standing.
ffmpeg -y -loglevel error -ss 43.6 -i "$T/take-a-site.mp4" -t 3.0 "${R2[@]}" "$C/c-peak.mp4"
# From just before the launch (0.483s) at 5x.
ffmpeg -y -loglevel error -i "$T/take-a-site.mp4" -vf "trim=0.45:16.45,setpts=(PTS-STARTPTS)/5" "${R2[@]}" "$C/c-play.mp4"
cp "$T/take-a-site-reveal.mp4" "$C/take-a-site-reveal.mp4"

echo "==> stills"
for f in take-a-intact take-b-intact take-a-empty take-a-site-intact take-a-site-empty; do
  cp "$T/$f.png" "$C/$f.png"
done
if [ -f capture/screenshots/scroll-000.png ]; then
  cp capture/screenshots/scroll-000.png "$C/site-top.png"
else
  echo "capture/ is missing: run npx hyperframes capture https://kusakuzushi.toshi0607.com/ -o ./capture" >&2
  exit 1
fi

echo "==> counters"
node tools/counters.mjs

echo "==> done"
for f in "$C"/*.mp4; do
  echo "    $f $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")s"
done
