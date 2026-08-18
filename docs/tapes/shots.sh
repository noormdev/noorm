#!/usr/bin/env bash
#
# Renders 04-screenshots.tape and trims each still back to its content.
#
# What "content" means changed when the TUI moved into the alternate screen.
# It draws to the full terminal height now — breadcrumb at the top, status bar
# pinned to the bottom — so every screen reaches both edges and the vertical
# trim only takes off the padding VHS drew. The horizontal trim still does real
# work, cutting each image to its own widest line, and the re-added border
# gives all of them the same margin in the brand background.
#
# So: do not size the canvas in 04-screenshots.tape expecting this to crop the
# slack back off. It cannot. The canvas is the frame.
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
