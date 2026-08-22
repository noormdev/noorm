#!/bin/sh
set -e

# noorm installer
# Usage: curl -fsSL https://noorm.dev/install.sh | sh
#    or: curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh

REPO="noormdev/noorm"
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
    install_dir=$(find_install_dir)

    echo "Installing noorm v${version} (${os}-${arch}) to ${install_dir}..."

    url="https://github.com/${REPO}/releases/download/${tag}/noorm-${suffix}"
    tmpfile=$(mktemp)

    if ! curl -fsSL -o "$tmpfile" "$url"; then
        echo "Error: Failed to download binary from ${url}" >&2
        echo "No binary available for ${os}-${arch}." >&2
        rm -f "$tmpfile"
        exit 1
    fi

    chmod +x "$tmpfile"
    mkdir -p "$install_dir"
    mv "$tmpfile" "${install_dir}/${BINARY_NAME}"

    echo "Installed noorm v${version} to ${install_dir}/${BINARY_NAME}"

    # Check if install dir is in PATH
    case ":$PATH:" in
        *":${install_dir}:"*) ;;
        *)
            echo ""
            echo "Add this to your shell profile to use noorm:"
            echo "  export PATH=\"${install_dir}:\$PATH\""
            ;;
    esac
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

# Find a user-writable bin directory already in PATH, or fall back to ~/.local/bin
find_install_dir() {
    # Allow override
    if [ -n "$NOORM_INSTALL_DIR" ]; then
        echo "$NOORM_INSTALL_DIR"
        return
    fi

    # Check common user-level bin dirs that are already in PATH
    for dir in \
        "$HOME/.local/bin" \
        "$HOME/bin" \
        "$HOME/.bin" \
        "$HOME/.cargo/bin" \
        "$HOME/go/bin" \
        "$HOME/.bun/bin"; do

        case ":$PATH:" in
            *":${dir}:"*)
                if [ -w "$dir" ] || [ -w "$(dirname "$dir")" ]; then
                    echo "$dir"
                    return
                fi
                ;;
        esac
    done

    # Default to ~/.local/bin (XDG standard)
    echo "$HOME/.local/bin"
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
