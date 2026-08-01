# Shared look for every noorm recording. Sourced, not run on its own.
#
# Palette is the brand's warm-ink dark mode from
# .claude/skills/noorm-design/colors_and_type.css — ink #161A20 background,
# cream #F2ECE0 text, ember #E05742 cursor. ANSI slots map onto the seed
# family (bronze for magenta, mossy green for green) so any color the CLI
# emits lands somewhere on-brand instead of on a stock terminal red.

Require docker
Require node

Set Shell bash

# Geist Mono is the brand face but is NOT bundled — install it or VHS silently
# falls back to a much wider default and every line wraps. See README.md.
#   brew install --cask font-geist-mono
Set FontFamily "Geist Mono"
Set FontSize 16
Set Padding 32
Set BorderRadius 10
Set TypingSpeed 45ms
Set Framerate 24

# 2x playback. The Sleep values in each tape are chosen for the CLI's real
# latency — long enough that a slow build or a confirm prompt never gets cut
# off — which makes honest recordings feel sluggish. Halving them instead would
# start losing steps on a slower machine, so keep the waits generous and speed
# up the finished GIF. Also halves the frame count, so the files get smaller.
#
# This does NOT shorten render wall-clock: VHS still waits out every Sleep.
Set PlaybackSpeed 2

# Sizing math, measured with `tput cols; tput lines` at FontSize 16:
# usable width = Width - 64, and one Geist Mono cell is ~10.2 x 22.4 px. So
#   Width  = cols * 10.2 + 64
#   Height = lines * 22.4 + 64
# noorm's diagnostic log prints absolute paths, so the CLI tapes need a wide
# terminal (~150 cols) or the output wraps mid-path and reads as noise.

Set Theme { "background": "#161A20", "foreground": "#F2ECE0", "cursor": "#E05742", "selection": "#2B3340", "black": "#212931", "red": "#E05742", "green": "#6E8F4E", "yellow": "#C2873C", "blue": "#4B7398", "magenta": "#916336", "cyan": "#D2A47A", "white": "#F2ECE0", "brightBlack": "#7E8590", "brightRed": "#ED7561", "brightGreen": "#8FAE6E", "brightYellow": "#D2A47A", "brightBlue": "#6E93B8", "brightMagenta": "#B47A45", "brightWhite": "#FFFFFF" }
