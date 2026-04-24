#!/usr/bin/env bash
set -euo pipefail

CHANGES_FILE="${1:-/tmp/page-changes.json}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REGRESSION_DIR="${SCRIPT_DIR}/../screenshots/regression"
PR_DIR="${REGRESSION_DIR}/pr"
PROD_DIR="${REGRESSION_DIR}/prod"
OUTPUT="${REGRESSION_DIR}/comparison.mp4"
TEMP_DIR="${REGRESSION_DIR}/temp"
mkdir -p "$TEMP_DIR"

PR_NUMBER="${PR_NUMBER:-0}"
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

ORDERED_PAGES=$(node -e "
  const c = require('${CHANGES_FILE}');
  const all = [
    ...c.changed.map(p => ({ path: p, type: 'CHANGED' })),
    ...c.new.map(p => ({ path: p, type: 'NEW' })),
    ...c.unchanged.map(p => ({ path: p, type: 'UNCHANGED' })),
  ];
  all.forEach(p => console.log(JSON.stringify(p)));
")

SEGMENT_INDEX=0
> "${TEMP_DIR}/concat.txt"

while IFS= read -r line; do
  PAGE_PATH=$(echo "$line" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    process.stdout.write(d.path);
  ")
  CHANGE_TYPE=$(echo "$line" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    process.stdout.write(d.type);
  ")

  SAFE_NAME=$(echo "$PAGE_PATH" | sed 's|/|_|g; s|^_||; s|_$||')
  [ -z "$SAFE_NAME" ] && SAFE_NAME="index"

  PR_IMG="${PR_DIR}/${SAFE_NAME}.png"
  PROD_IMG="${PROD_DIR}/${SAFE_NAME}.png"

  [ ! -f "$PR_IMG" ] && continue
  [ ! -f "$PROD_IMG" ] && continue

  SEGMENT_FILE="${TEMP_DIR}/segment_$(printf '%04d' $SEGMENT_INDEX).mp4"

  case "$CHANGE_TYPE" in
    CHANGED)   BADGE_COLOR="yellow" ;;
    NEW)       BADGE_COLOR="#22c27a" ;;
    UNCHANGED) BADGE_COLOR="#8ab0e8" ;;
  esac

  ffmpeg -y -loglevel warning \
    -loop 1 -t 3 -i "$PROD_IMG" \
    -loop 1 -t 3 -i "$PR_IMG" \
    -filter_complex "
      [0:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=#04060f[left];
      [1:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=#04060f[right];
      [left][right]hstack=inputs=2[combined];
      [combined]pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#04060f[padded];
      [padded]
        drawtext=text='PRODUCTION':fontsize=18:fontcolor=white:x=30:y=20:fontfile=${FONT},
        drawtext=text='PR \#${PR_NUMBER}':fontsize=18:fontcolor=white:x=670:y=20:fontfile=${FONT},
        drawtext=text='${CHANGE_TYPE}':fontsize=16:fontcolor=${BADGE_COLOR}:x=(w-text_w)/2:y=20:fontfile=${FONT},
        drawtext=text='${PAGE_PATH}':fontsize=13:fontcolor=#8ab0e8:x=(w-text_w)/2:y=h-30:fontfile=${FONT_REGULAR}
    " \
    -c:v libx264 -pix_fmt yuv420p -r 1 "$SEGMENT_FILE"

  echo "file '${SEGMENT_FILE}'" >> "${TEMP_DIR}/concat.txt"
  SEGMENT_INDEX=$((SEGMENT_INDEX + 1))
done <<< "$ORDERED_PAGES"

if [ -s "${TEMP_DIR}/concat.txt" ]; then
  ffmpeg -y -loglevel warning \
    -f concat -safe 0 -i "${TEMP_DIR}/concat.txt" \
    -c:v libx264 -pix_fmt yuv420p "$OUTPUT"
  echo "Video generated: $OUTPUT"
else
  ffmpeg -y -loglevel warning \
    -f lavfi -i "color=c=#04060f:s=1280x720:d=3" \
    -vf "drawtext=text='No pages to compare':fontsize=30:fontcolor=#d8e4ff:x=(w-text_w)/2:y=(h-text_h)/2:fontfile=${FONT}" \
    -c:v libx264 -pix_fmt yuv420p "$OUTPUT"
  echo "No pages to compare — placeholder video generated."
fi

rm -rf "$TEMP_DIR"
