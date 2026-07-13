#!/usr/bin/env node

/**
 * Downloads the platform-specific noorm binary on npm install.
 *
 * The @noormdev/cli npm package is a thin wrapper. The actual CLI is a
 * bun-compiled binary hosted on GitHub Releases. This script runs on
 * postinstall to fetch the correct binary for the user's OS and architecture.
 */

import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, chmodSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { get as httpsGet } from 'https';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const BIN_DIR = resolve(PACKAGE_ROOT, 'bin');
const REPO = 'noormdev/noorm';

const BINARY_NAME = process.platform === 'win32' ? 'noorm.exe' : 'noorm';
const DEST = resolve(BIN_DIR, BINARY_NAME);
const DOWNLOAD_DEST = `${DEST}.download`;
const CHECKSUMS_TMP = resolve(BIN_DIR, 'checksums.txt.tmp');

/**
 * A confirmed-bad or unverifiable binary. Distinguishes a hard-fail from
 * every other (soft) failure so the top-level `main().catch()` can tell
 * them apart without matching on error message text.
 */
class ChecksumFailure extends Error {

    constructor(message) {

        super(message);
        this.name = 'ChecksumFailure';

    }

}

/**
 * Resolves the platform suffix used in binary asset names.
 *
 * Maps Node's process.platform and process.arch to the naming convention
 * used by the build-binary script: noorm-{os}-{arch}
 */
function getPlatformSuffix() {

    const platform = process.platform;
    const arch = process.arch;

    const osMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
    const archMap = { arm64: 'arm64', x64: 'x64' };

    const os = osMap[platform];
    const cpu = archMap[arch];

    if (!os || !cpu) {
        console.error(`Unsupported platform: ${platform}-${arch}`);
        process.exit(0); // Don't fail install
    }

    const suffix = `${os}-${cpu}`;

    if (platform === 'win32') {
        return `${suffix}.exe`;
    }

    return suffix;

}

/**
 * Reads the package version to determine which release to download from.
 */
async function getVersion() {

    const { readFile } = await import('fs/promises');
    const pkg = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));

    return pkg.version;

}

/**
 * Follow redirects and download a URL to a file path.
 *
 * GitHub Releases URLs redirect to S3. This follows up to 5 redirects.
 */
function download(url, dest, redirects = 0) {

    if (redirects > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }

    return new Promise((resolve, reject) => {

        httpsGet(url, { headers: { 'User-Agent': 'noorm-installer' } }, (res) => {

            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(download(res.headers.location, dest, redirects + 1));
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                return;
            }

            const file = createWriteStream(dest);
            res.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                file.close();
                reject(err);
            });

        }).on('error', reject);

    });

}

/**
 * Determine whether the user has opted out of binary checksum verification.
 *
 * Mirrors the TS `isInsecureMode` truthy-string parsing (src/cli/_utils.ts)
 * so the escape hatch behaves identically from a shell's point of view:
 * any non-empty NOORM_INSECURE value except `0` or `false` (case-insensitive)
 * is truthy.
 *
 * This only ever widens the "we couldn't verify" case -- checksums.txt
 * unreachable, or missing an entry for this asset -- into a warning. It
 * never downgrades a confirmed checksum mismatch, which always fails.
 */
function isInsecureMode() {

    const env = process.env.NOORM_INSECURE;

    if (env === undefined || env === '') return false;
    if (env === '0') return false;
    if (env.toLowerCase() === 'false') return false;

    return true;

}

/**
 * Parse a `shasum -a 256`-style checksums file into an asset -> sha256 map.
 *
 * Mirrors src/core/update/checksum.ts's parseChecksums regex exactly (that
 * module can't be imported here -- this script runs before the package is
 * built). Matches the exact format the release workflow produces: a 64-char
 * hex hash, whitespace, an optional `*` binary-mode marker, then the
 * filename. Blank/malformed lines are skipped rather than thrown on.
 */
function parseChecksums(text) {

    const out = {};

    for (const line of text.split('\n')) {

        const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);

        if (match && match[1] && match[2]) {
            out[match[2]] = match[1].toLowerCase();
        }

    }

    return out;

}

/**
 * Compute the sha256 hex digest of a file on disk.
 *
 * Streams the file through the hash rather than buffering it whole --
 * release binaries run tens of MB.
 */
function sha256File(path) {

    return new Promise((resolve, reject) => {

        const hash = createHash('sha256');
        const stream = createReadStream(path);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);

    });

}

/**
 * Deletes the download-in-progress temp files, if present. Safe to call
 * from any terminal path (success, hard-fail, soft-fail) -- guards on
 * existsSync so a file that was never created, or already renamed away
 * on success, is a no-op.
 */
function cleanupTempFiles() {

    if (existsSync(DOWNLOAD_DEST)) unlinkSync(DOWNLOAD_DEST);
    if (existsSync(CHECKSUMS_TMP)) unlinkSync(CHECKSUMS_TMP);

}

/**
 * Verifies the freshly downloaded binary at DOWNLOAD_DEST against
 * checksums.txt fetched from the same release tag.
 *
 * Same invariant as every other verification call site in this ticket
 * (src/core/update/checksum.ts, install.sh): a confirmed hash mismatch is
 * ALWAYS a hard failure -- NOORM_INSECURE cannot downgrade it. Only "we
 * couldn't get a trustworthy answer" (checksums.txt unreachable, or
 * fetched but missing an entry for this asset) is bypassable.
 *
 * @throws {ChecksumFailure} on a confirmed mismatch, or when verification
 * could not complete and NOORM_INSECURE is not set.
 */
async function verifyChecksum(checksumsUrl, assetName) {

    // A failed checksums.txt fetch is captured here, not thrown -- it
    // folds into the "could not verify" branch below, which NOORM_INSECURE
    // governs, same as a fetch that succeeds but has no entry for us.
    const fetched = await download(checksumsUrl, CHECKSUMS_TMP)
        .then(() => true)
        .catch(() => false);

    let expected;

    if (fetched) {

        const { readFile } = await import('fs/promises');
        const text = await readFile(CHECKSUMS_TMP, 'utf8');
        expected = parseChecksums(text)[assetName];

    }

    if (expected) {

        const actual = await sha256File(DOWNLOAD_DEST);

        if (actual.toLowerCase() !== expected.toLowerCase()) {

            throw new ChecksumFailure(
                `checksum mismatch for ${assetName} (expected ${expected}, got ${actual})`
            );

        }

        return;

    }

    if (isInsecureMode()) {

        console.warn(
            `Warning: could not verify checksum for ${assetName} (checksums.txt unreachable or missing ` +
            'an entry for this asset); proceeding unverified because NOORM_INSECURE is set.'
        );

        return;

    }

    throw new ChecksumFailure(
        `could not verify checksum for ${assetName}: checksums.txt unreachable or has no entry for this asset ` +
        '(set NOORM_INSECURE=1 to install anyway)'
    );

}

/**
 * Main postinstall routine.
 *
 * Downloads the correct binary to a temp path, verifies its checksum, and
 * only then promotes it to bin/. Exits cleanly on failure so npm install
 * doesn't break -- except a confirmed-bad or unverifiable binary, see
 * main().catch() below.
 */
async function main() {

    const suffix = getPlatformSuffix();
    const version = await getVersion();
    const assetName = `noorm-${suffix}`;
    const tag = `@noormdev/cli@${version}`;
    const url = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;
    const checksumsUrl = `https://github.com/${REPO}/releases/download/${tag}/checksums.txt`;

    // Skip if binary already exists (e.g. reinstall)
    if (existsSync(DEST)) {
        console.log(`noorm binary already exists at ${DEST}`);
        return;
    }

    mkdirSync(BIN_DIR, { recursive: true });

    console.log(`Downloading noorm ${version} for ${suffix}...`);

    await download(url, DOWNLOAD_DEST);

    // Verify BEFORE trusting the binary -- chmod+rename below is the point
    // this script starts treating the file as the live noorm CLI.
    await verifyChecksum(checksumsUrl, assetName);

    if (process.platform !== 'win32') {
        chmodSync(DOWNLOAD_DEST, 0o755);
    }

    renameSync(DOWNLOAD_DEST, DEST);
    cleanupTempFiles();

    console.log(`✓ noorm ${version} installed`);

}

main().catch((err) => {

    cleanupTempFiles();

    if (err instanceof ChecksumFailure) {

        // Deliberate, scoped exception to this script's "never fail npm
        // install" philosophy: every other failure mode below still exits
        // 0, but a confirmed-bad or unverifiable binary must not be
        // silently trusted and installed as the user's noorm CLI.
        console.error(`Error: ${err.message}`);
        process.exit(1);

    }

    console.error(`Warning: Could not download noorm binary: ${err.message}`);
    console.error('You can download it manually from:');
    console.error(`  https://github.com/${REPO}/releases`);
    // Don't fail the install
    process.exit(0);

});
