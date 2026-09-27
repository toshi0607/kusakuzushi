#!/usr/bin/env bash
# Fetches the OFL fonts the compositions and the HUD harness use. They are not
# committed (assets/ is ignored); this pulls the same files from google/fonts.
#
#   assets/fonts/  DotGothic16-Regular, IBMPlexSansJP-Regular, IBMPlexSansJP-SemiBold
#   tools/fonts/   DotGothic16-Regular (harness.html serves only tools/)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="https://github.com/google/fonts/raw/main/ofl"
mkdir -p assets/fonts tools/fonts

fetch() {
  local url="$1" out="$2"
  if [ ! -s "$out" ]; then
    curl -sfL -o "$out" "$url"
    echo "    fetched $out"
  fi
}

fetch "$BASE/dotgothic16/DotGothic16-Regular.ttf" assets/fonts/DotGothic16-Regular.ttf
fetch "$BASE/ibmplexsansjp/IBMPlexSansJP-Regular.ttf" assets/fonts/IBMPlexSansJP-Regular.ttf
fetch "$BASE/ibmplexsansjp/IBMPlexSansJP-SemiBold.ttf" assets/fonts/IBMPlexSansJP-SemiBold.ttf
cp assets/fonts/DotGothic16-Regular.ttf tools/fonts/DotGothic16-Regular.ttf
