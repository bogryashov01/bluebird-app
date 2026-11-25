#!/bin/zsh
# Frames real app captures into App Store screenshots at exact sizes.
# Input:  raw/<id>.png  — portrait captures of the real app (ids from screens.tsv).
# Output: out/1320x2868/<id>.png (Dynamic Island large) and out/1206x2622/<id>.png (Dynamic Island medium, required).
# A screen without a raw capture is SKIPPED (no placeholder is ever written). Exit code 1 if any screen is missing
# or any output has the wrong size.
set -euo pipefail
HERE="${0:A:h}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOGO="file://$HERE/../artifacts/bluebird/assets/images/bluebird-logo-white.png"
enc() { python3 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))" "${1:-}"; }
dim() { sips -g "$2" "$1" 2>/dev/null | awk '/pixel/{print $2}'; }
rc=0
for size in 1320x2868 1206x2622; do
  w=${size%x*}; h=${size#*x}; mkdir -p "$HERE/out/$size"
  while IFS=$'\t' read -r id headline sub; do
    [[ -z "$id" ]] && continue
    raw="$HERE/raw/$id.png"
    if [[ ! -f "$raw" ]]; then
      rm -f "$HERE/out/$size/$id.png"
      echo "SKIP    $size $id (no raw/$id.png)"; rc=1; continue
    fi
    rw=$(dim "$raw" pixelWidth); rh=$(dim "$raw" pixelHeight)
    if (( rw < 1000 || rh <= rw )); then
      echo "REJECT  $size $id (raw ${rw}x${rh}: need a portrait capture at least 1000 px wide)"; rc=1; continue
    fi
    url="file://$HERE/frame.html?logo=$(enc "$LOGO")&headline=$(enc "$headline")&sub=$(enc "$sub")&img=$(enc "file://$raw")&ratio=$(enc "$rw/$rh")"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --allow-file-access-from-files --virtual-time-budget=4000 \
      --window-size=$w,$h --screenshot="$HERE/out/$size/$id.png" "$url" >/dev/null 2>&1
    ow=$(dim "$HERE/out/$size/$id.png" pixelWidth); oh=$(dim "$HERE/out/$size/$id.png" pixelHeight)
    if [[ "$ow" == "$w" && "$oh" == "$h" ]]; then
      echo "OK      $size $id (${ow}x${oh})"
    else
      echo "BADSIZE $size $id (${ow}x${oh})"; rm -f "$HERE/out/$size/$id.png"; rc=1
    fi
  done < "$HERE/screens.tsv"
done
exit $rc
