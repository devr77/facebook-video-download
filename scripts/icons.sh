#!/usr/bin/env bash
# Regenerates PNG icons + social share image from SVG sources. Requires rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")/.."
out=src/assets/img
mkdir -p "$out"

rsvg-convert -w 32 -h 32 src/static/favicon.svg -o "$out/favicon-32.png"
rsvg-convert -w 180 -h 180 src/static/favicon.svg -o "$out/apple-touch-icon.png"
rsvg-convert -w 192 -h 192 src/static/favicon.svg -o "$out/icon-192.png"
rsvg-convert -w 512 -h 512 src/static/favicon.svg -o "$out/icon-512.png"
rsvg-convert -w 1200 -h 630 scripts/og-image.svg -o "$out/og-image.png"

echo "Icons written to $out"
