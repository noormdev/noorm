#!/bin/sh
# Short URL for the ignatius installer; runs the one copy kept in the ignatius repo.
# Variables set on this sh reach it: curl -fsSL https://noorm.dev/ignatius.sh | IGNATIUS_VERSION=v0.23.0 sh
set -eu

installer=$(mktemp)
trap 'rm -f "$installer"' EXIT

curl -fsSL https://raw.githubusercontent.com/noormdev/ignatius/main/install.sh -o "$installer"
sh "$installer"
