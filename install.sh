#!/bin/sh
set -e

# noorm installer
# Usage: curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh

REPO="noormdev/noorm"
INSTALL_DIR="${NOORM_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="noorm"

main() {
    os=$(detect_os)
    arch=$(detect_arch)
    suffix="${os}-${arch}"

    if [ "$os" = "windows" ]; then
        suffix="${suffix}.exe"
        BINARY_NAME="noorm.exe"
    fi

    tag=$(latest_cli_tag)
    version=$(echo "$tag" | sed 's/@noormdev\/cli@//')

    echo "Installing noorm v${version} (${os}-${arch})..."

    url="https://github.com/${REPO}/releases/download/${tag}/noorm-${suffix}"
    tmpfile=$(mktemp)

    if ! curl -fsSL -o "$tmpfile" "$url"; then
        echo "Error: Failed to download binary from ${url}" >&2
        echo "No binary available for ${os}-${arch}." >&2
        rm -f "$tmpfile"
        exit 1
    fi

    chmod +x "$tmpfile"

    if [ -w "$INSTALL_DIR" ]; then
        mv "$tmpfile" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        echo "Installing to ${INSTALL_DIR} (requires sudo)..."
        sudo mv "$tmpfile" "${INSTALL_DIR}/${BINARY_NAME}"
    fi

    echo "Installed noorm v${version} to ${INSTALL_DIR}/${BINARY_NAME}"
}

detect_os() {
    case "$(uname -s)" in
        Darwin)  echo "darwin" ;;
        Linux)   echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  echo "x64" ;;
        arm64|aarch64) echo "arm64" ;;
        *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
}

latest_cli_tag() {
    tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" \
        | grep -o '"tag_name": *"@noormdev/cli@[^"]*"' \
        | head -1 \
        | sed 's/"tag_name": *"//;s/"//')

    if [ -z "$tag" ]; then
        echo "Error: Could not find a CLI release." >&2
        exit 1
    fi

    echo "$tag"
}

main
