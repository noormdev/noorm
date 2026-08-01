#!/usr/bin/env bash
#
# Renders 04-screenshots.tape and crops each still down to its own content.
#
# One tape has one canvas, but the TUI screens run from ~14 to ~49 lines. The
# canvas is sized for the tallest (the add-config form), so every other shot
# comes out with a slab of empty terminal below it. This trims that back off
# and re-adds even padding, so each image is sized to what it actually shows.
#
# Output lands in ../public/image/tui/.
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BG="#161A20"        # warm ink, the dark-mode terminal background
PAD=28
SRC="shots"
DEST="../public/image/tui"

command -v vhs >/dev/null || { echo "error: vhs not installed (brew install vhs)" >&2; exit 1; }
command -v magick >/dev/null || { echo "error: imagemagick not installed" >&2; exit 1; }

rm -rf "$SRC"
mkdir -p "$SRC" "$DEST" ../../tmp

vhs 04-screenshots.tape

shopt -s nullglob
shots=("$SRC"/*.png)

if [ ${#shots[@]} -eq 0 ]; then

    echo "error: tape produced no screenshots" >&2
    exit 1
fi

for f in "${shots[@]}"; do

    name="$(basename "$f")"

    # -trim removes the uniform background on all sides, including the padding
    # VHS drew, so the padding is re-added afterwards at a known width. +repage
    # resets the virtual canvas -trim leaves behind, without which the offset
    # comes back on the next operation.
    magick "$f" \
        -bordercolor "$BG" -border 1 \
        -fuzz 2% -trim +repage \
        -bordercolor "$BG" -border "$PAD" \
        "$DEST/$name"

    printf '%-28s %s\n' "$name" "$(magick identify -format '%wx%h' "$DEST/$name")"
done

rm -rf "$SRC" ../../tmp/screenshots-throwaway.gif

echo
echo "wrote ${#shots[@]} stills to $DEST"
