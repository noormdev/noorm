#!/bin/sh
# noorm CLI installer
#
# Usage:
#   curl -fsSL https://noorm.dev/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/scripts/install.sh | sh
#
# Options (via environment):
#   NOORM_VERSION=1.0.0    Pin a specific version (default: latest)
#   NOORM_INSTALL_DIR=~/.noorm/bin  Override install directory
#
set -e

REPO="noormdev/noorm"
INSTALL_DIR="${NOORM_INSTALL_DIR:-$HOME/.noorm/bin}"
BINARY_NAME="noorm"

# --- Helpers ---

info() {
    printf '  \033[1;34m%s\033[0m %s\n' "$1" "$2"
}

success() {
    printf '  \033[1;32m✓\033[0m %s\n' "$1"
}

fail() {
    printf '  \033[1;31m✗\033[0m %s\n' "$1" >&2
    exit 1
}

# --- Detect platform ---

detect_platform() {

    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Darwin)  OS="darwin" ;;
        Linux)   OS="linux" ;;
        MINGW*|MSYS*|CYGWIN*)
            fail "Windows is not supported by this installer. Download the binary from:"
            fail "  https://github.com/$REPO/releases"
            ;;
        *)
            fail "Unsupported operating system: $OS"
            ;;
    esac

    case "$ARCH" in
        x86_64|amd64)  ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)
            fail "Unsupported architecture: $ARCH"
            ;;
    esac

}

# --- Resolve version ---

resolve_version() {

    if [ -n "$NOORM_VERSION" ]; then
        VERSION="$NOORM_VERSION"
        info "Version:" "$VERSION (pinned)"
        return
    fi

    info "Resolving:" "latest version..."

    # Find the latest @noormdev/cli release tag
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases" \
        | grep -o '"tag_name": *"@noormdev/cli@[^"]*"' \
        | head -1 \
        | sed 's/.*@noormdev\/cli@//' \
        | sed 's/"//')

    if [ -z "$VERSION" ]; then
        fail "Could not determine latest version. Set NOORM_VERSION manually."
    fi

    info "Version:" "$VERSION"

}

# --- Download ---

download_binary() {

    ASSET_NAME="noorm-${OS}-${ARCH}"
    TAG="@noormdev/cli@${VERSION}"
    DOWNLOAD_URL="https://github.com/$REPO/releases/download/${TAG}/${ASSET_NAME}"

    info "Platform:" "${OS}-${ARCH}"
    info "Downloading:" "$DOWNLOAD_URL"

    TMPDIR_DL="$(mktemp -d)"
    TMPFILE="${TMPDIR_DL}/${BINARY_NAME}"

    HTTP_CODE=$(curl -fsSL -w '%{http_code}' -o "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null || true)

    if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
        rm -rf "$TMPDIR_DL"
        fail "Download failed (HTTP $HTTP_CODE). Check that version $VERSION has a binary for ${OS}-${ARCH}."
    fi

}

# --- Install ---

install_binary() {

    mkdir -p "$INSTALL_DIR"
    mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    rm -rf "$TMPDIR_DL"

    success "Installed noorm to ${INSTALL_DIR}/${BINARY_NAME}"

}

# --- PATH check ---

check_path() {

    case ":$PATH:" in
        *":${INSTALL_DIR}:"*)
            # Already in PATH
            ;;
        *)
            echo ""
            info "Add to PATH:" "Add this to your shell profile (~/.zshrc, ~/.bashrc, etc.):"
            echo ""
            echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
            echo ""
            ;;
    esac

}

# --- Verify ---

verify_install() {

    if [ -x "${INSTALL_DIR}/${BINARY_NAME}" ]; then
        success "noorm $VERSION is ready"
    else
        fail "Installation verification failed"
    fi

}

# --- Main ---

main() {

    echo ""
    echo "  noorm installer"
    echo ""

    detect_platform
    resolve_version
    download_binary
    install_binary
    check_path
    verify_install

    echo ""

}

main
