#!/bin/sh
# noorm installer — downloads the latest CLI binary for your platform.
# Usage: curl -fsSL https://noorm.dev/install.sh | bash
set -e

REPO="noormdev/noorm"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="noorm"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Darwin)  PLATFORM="darwin" ;;
    Linux)   PLATFORM="linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *) echo "Error: Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
    arm64|aarch64) ARCH_SUFFIX="arm64" ;;
    x86_64|amd64)  ARCH_SUFFIX="x64" ;;
    *) echo "Error: Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

if [ "$PLATFORM" = "windows" ]; then
    SUFFIX="${PLATFORM}-${ARCH_SUFFIX}.exe"
else
    SUFFIX="${PLATFORM}-${ARCH_SUFFIX}"
fi

ASSET_NAME="noorm-${SUFFIX}"

echo "Detecting platform... ${PLATFORM}/${ARCH_SUFFIX}"

# Find the latest CLI release tag via GitHub API
echo "Finding latest release..."
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" \
    -H "Accept: application/vnd.github+json")"

TAG="$(echo "$RELEASE_JSON" | grep -o '"tag_name": *"@noormdev/cli@[^"]*"' | head -1 | sed 's/"tag_name": *"//;s/"$//')"

if [ -z "$TAG" ]; then
    echo "Error: Could not find a @noormdev/cli release." >&2
    exit 1
fi

VERSION="$(echo "$TAG" | sed 's/@noormdev\/cli@//')"
echo "Latest version: ${VERSION}"

# URL-encode the tag (@ → %40, / → %2F)
ENCODED_TAG="$(echo "$TAG" | sed 's/@/%40/g;s/\//%2F/g')"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${ENCODED_TAG}/${ASSET_NAME}"

# Download
TMPFILE="$(mktemp)"
echo "Downloading ${ASSET_NAME}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMPFILE"
chmod +x "$TMPFILE"

# Install
if [ -w "$INSTALL_DIR" ]; then
    mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
else
    echo "Installing to ${INSTALL_DIR} (requires sudo)..."
    sudo mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo ""
echo "noorm ${VERSION} installed to ${INSTALL_DIR}/${BINARY_NAME}"
echo "Run 'noorm --version' to verify."
