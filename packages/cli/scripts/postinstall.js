#!/usr/bin/env node

/**
 * Downloads the platform-specific noorm binary on npm install.
 *
 * The @noormdev/cli npm package is a thin wrapper. The actual CLI is a
 * bun-compiled binary hosted on GitHub Releases. This script runs on
 * postinstall to fetch the correct binary for the user's OS and architecture.
 */

import { createWriteStream, existsSync, chmodSync, mkdirSync } from 'fs';
import { get as httpsGet } from 'https';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const BIN_DIR = resolve(PACKAGE_ROOT, 'bin');
const REPO = 'noormdev/noorm';

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
 * Main postinstall routine.
 *
 * Downloads the correct binary, saves it to bin/, and makes it executable.
 * Exits cleanly on failure so npm install doesn't break.
 */
async function main() {

    const suffix = getPlatformSuffix();
    const version = await getVersion();
    const assetName = `noorm-${suffix}`;
    const tag = `@noormdev/cli@${version}`;
    const url = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;

    const binaryName = process.platform === 'win32' ? 'noorm.exe' : 'noorm';
    const dest = resolve(BIN_DIR, binaryName);

    // Skip if binary already exists (e.g. reinstall)
    if (existsSync(dest)) {
        console.log(`noorm binary already exists at ${dest}`);
        return;
    }

    mkdirSync(BIN_DIR, { recursive: true });

    console.log(`Downloading noorm ${version} for ${suffix}...`);

    await download(url, dest);

    if (process.platform !== 'win32') {
        chmodSync(dest, 0o755);
    }

    console.log(`✓ noorm ${version} installed`);

}

main().catch((err) => {

    console.error(`Warning: Could not download noorm binary: ${err.message}`);
    console.error('You can download it manually from:');
    console.error(`  https://github.com/${REPO}/releases`);
    // Don't fail the install
    process.exit(0);

});
