/**
 * Tests for the npm postinstall binary download (`packages/cli/scripts/postinstall.js`).
 *
 * The script is spawned as a real `node` process rather than imported: it is
 * plain ESM shipped in the npm tarball (the repo does not set `allowJs`), and
 * spawning exercises the exact invocation a package manager performs.
 *
 * The invariant under test is a split one, and both halves matter:
 *
 *   - Inside this monorepo the release binary must NEVER be downloaded. The
 *     script pins its download to the release tag matching packages/cli's
 *     version, which in a source checkout is routinely unreleased (any commit
 *     after a version bump, and every commit before that version is cut). CI
 *     builds the CLI from source and never executes the downloaded binary, so
 *     the download is dead weight that can only ever break `bun install`.
 *
 *   - For an npm consumer the download must still happen. A skip check that is
 *     too broad would silently install the wrapper with no binary behind it,
 *     which is a worse failure than the one it fixes -- it surfaces at first
 *     use rather than at install time.
 *
 * Both cases run against a fabricated directory tree rather than the real
 * repo, so neither depends on whether packages/cli/bin happens to be populated
 * on the machine running the tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const REAL_SCRIPT = resolve(import.meta.dir, '../../packages/cli/scripts/postinstall.js');

// Matched loosely (case-insensitive substring) so the test pins the behavior,
// not the exact prose of the console message.
const SKIP_MARKER = 'source checkout';
const DOWNLOAD_MARKER = 'Downloading noorm';

let workDir: string;

/**
 * Writes a package tree containing a copy of the real postinstall script and
 * returns the directory the script lands in.
 *
 * @param layout directory path, relative to workDir, that plays the role of
 * packages/cli -- i.e. where package.json and scripts/postinstall.js go.
 * @param rootPkg package.json to write two levels above `layout`, or null to
 * leave that level empty (the npm-consumer case).
 */
const fabricate = async (layout: string, rootPkg: Record<string, unknown> | null) => {

    const pkgDir = join(workDir, layout);

    await mkdir(join(pkgDir, 'scripts'), { recursive: true });
    await copyFile(REAL_SCRIPT, join(pkgDir, 'scripts', 'postinstall.js'));

    await writeFile(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@noormdev/cli', version: '1.0.0-alpha.39' }),
    );

    if (rootPkg) {

        await writeFile(
            join(pkgDir, '..', '..', 'package.json'),
            JSON.stringify(rootPkg),
        );

    }

    return pkgDir;

};

/**
 * Runs the fabricated script to completion and returns its output.
 *
 * Only safe for cases that terminate without network access -- see
 * `runUntilDownload` for the consumer case, which does reach the network.
 */
const run = async (pkgDir: string) => {

    const proc = Bun.spawn(['node', join(pkgDir, 'scripts', 'postinstall.js')], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NOORM_INSECURE: '' },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);

    return { stdout, stderr, exitCode, output: stdout + stderr };

};

/**
 * Runs the script only until it announces the download, then kills it.
 *
 * The consumer path deliberately hits GitHub Releases, which a test must not
 * wait on. Reading up to the announcement is enough to prove the skip check
 * did not swallow this case, and killing early keeps the test hermetic: the
 * assertion holds whether or not the machine has network.
 */
const runUntilDownload = async (pkgDir: string) => {

    const proc = Bun.spawn(['node', join(pkgDir, 'scripts', 'postinstall.js')], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NOORM_INSECURE: '' },
    });

    let seen = '';

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    while (!seen.includes(DOWNLOAD_MARKER)) {

        const { done, value } = await reader.read();

        if (done) break;

        seen += decoder.decode(value, { stream: true });

    }

    proc.kill();
    await proc.exited;

    return seen;

};

beforeAll(async () => {

    workDir = await mkdtemp(join(tmpdir(), 'noorm-postinstall-'));

});

afterAll(async () => {

    await rm(workDir, { recursive: true, force: true });

});

describe('postinstall: binary download', () => {

    it('skips the download inside the noorm monorepo source checkout', async () => {

        const pkgDir = await fabricate('repo/packages/cli', {
            name: '@noormdev/main',
            workspaces: ['packages/*'],
        });

        const { output, exitCode } = await run(pkgDir);

        expect(output.toLowerCase()).toContain(SKIP_MARKER);
        expect(output).not.toContain(DOWNLOAD_MARKER);

        // The whole point: a source checkout must not be able to fail an install.
        expect(exitCode).toBe(0);

        expect(existsSync(join(pkgDir, 'bin', 'noorm'))).toBe(false);

    });

    it('still downloads for an npm consumer outside the monorepo', async () => {

        const pkgDir = await fabricate('consumer/node_modules/@noormdev/cli', null);

        const seen = await runUntilDownload(pkgDir);

        expect(seen).toContain(DOWNLOAD_MARKER);
        expect(seen.toLowerCase()).not.toContain(SKIP_MARKER);

    });

    it('does not mistake an unrelated parent package for the monorepo root', async () => {

        const pkgDir = await fabricate('other/packages/cli', {
            name: '@someoneelse/monorepo',
            workspaces: ['packages/*'],
        });

        const seen = await runUntilDownload(pkgDir);

        expect(seen).toContain(DOWNLOAD_MARKER);
        expect(seen.toLowerCase()).not.toContain(SKIP_MARKER);

    });

});
