#!/bin/sh
set -e

# noorm installer
# Usage: curl -fsSL https://noorm.dev/install.sh | sh
#    or: curl -fsSL https://raw.githubusercontent.com/noormdev/noorm/master/install.sh | sh
#
# NOORM_INSECURE: set to a truthy value (anything other than empty, "0", or "false")
#   to skip checksum verification when checksums.txt is unreachable, has no entry
#   for this platform, or no sha256 tool is available. Does NOT bypass a confirmed
#   checksum mismatch -- a verified bad hash always aborts the install.

REPO="noormdev/noorm"
BINARY_NAME="noorm"

# NOORM_INSECURE truthy check -- mirrors the TS isInsecureMode/isYesMode convention:
# any value other than empty, "0", or "false" (case-insensitive) counts as truthy.
is_insecure() {
    case "$NOORM_INSECURE" in
        ''|0|false|FALSE|False) return 1 ;;
        *) return 0 ;;
    esac
}

# Compare $file's sha256 against its entry (matched by $asset name) in $checksums.
# Sets $verify_result to "match", "mismatch", or "unverifiable" (no entry / no
# hashing tool present -- the caller decides whether NOORM_INSECURE allows that).
verify_checksum() {
    file="$1"
    checksums="$2"
    asset="$3"

    expected=$(awk -v a="$asset" '$2 == a { print $1 }' "$checksums" | head -n1)

    if [ -z "$expected" ]; then
        verify_result="unverifiable"
        return
    fi

    if command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 "$file" | awk '{ print $1 }')
    elif command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$file" | awk '{ print $1 }')
    else
        verify_result="unverifiable"
        return
    fi

    if [ "$expected" = "$actual" ]; then
        verify_result="match"
    else
        verify_result="mismatch"
    fi
}

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

    asset="noorm-${suffix}"
    url_checksums="https://github.com/${REPO}/releases/download/${tag}/checksums.txt"
    checksums_file=$(mktemp)

    if curl -fsSL -o "$checksums_file" "$url_checksums"; then
        have_checksums=1
    else
        have_checksums=0
    fi

    if [ "$have_checksums" -eq 1 ]; then
        verify_checksum "$tmpfile" "$checksums_file" "$asset"
    else
        verify_result="unverifiable"
    fi

    case "$verify_result" in
        match)
            echo "Checksum verified for ${asset}."
            ;;
        mismatch)
            echo "Error: checksum mismatch for ${asset} -- downloaded binary does not match checksums.txt." >&2
            rm -f "$tmpfile" "$checksums_file"
            exit 1
            ;;
        unverifiable)
            if is_insecure; then
                echo "Warning: could not verify checksum for ${asset} (checksums.txt unreachable, no matching entry, or no sha256 tool available) -- proceeding unverified because NOORM_INSECURE is set." >&2
            else
                echo "Error: could not verify checksum for ${asset} (checksums.txt unreachable, no matching entry, or no sha256 tool available)." >&2
                echo "Set NOORM_INSECURE=1 to bypass this check and install unverified (never bypasses a confirmed mismatch)." >&2
                rm -f "$tmpfile" "$checksums_file"
                exit 1
            fi
            ;;
    esac

    rm -f "$checksums_file"

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
