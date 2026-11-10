/**
 * A throwaway HOME and project directory. `~/.noorm` is resolved from
 * `homedir()` when the identity storage module loads, so only a child process
 * with HOME repointed can aim it at a temp directory.
 */
import { expect } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import type { KeyPair } from '../../../src/core/identity/types.js';

/** Paths inside a throwaway HOME, and the child-process runner bound to it. */
export interface ThrowawayHome {
    noormHome: string;
    projectRoot: string;
    keyPath: string;
    pubPath: string;
    metadataPath: string;

    /** Run a fixture with HOME repointed and the project as cwd; returns its stdout. */
    run(script: string, ...args: string[]): string;

    /** Write a complete identity: key, public key and metadata. */
    writeIdentity(): Promise<KeyPair>;

    remove(): Promise<void>;
}

/**
 * Create the directories, with a git user so identity defaults resolve.
 *
 * @example
 * const home = await createThrowawayHome()
 * const frame = home.run(FIXTURE, 'show')
 * await home.remove()
 */
export async function createThrowawayHome(): Promise<ThrowawayHome> {

    const home = await mkdtemp(join(tmpdir(), 'noorm-home-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'noorm-proj-'));
    const noormHome = join(home, '.noorm');

    await mkdir(noormHome, { recursive: true });
    await writeFile(join(home, '.gitconfig'), '[user]\n\tname = Git Person\n\temail = git@example.com\n');

    const keyPath = join(noormHome, 'identity.key');
    const pubPath = join(noormHome, 'identity.pub');
    const metadataPath = join(noormHome, 'identity.json');

    return {
        noormHome,
        projectRoot,
        keyPath,
        pubPath,
        metadataPath,

        run(script, ...args) {

            const { GIT_CONFIG_GLOBAL: _global, GIT_DIR: _dir, ...env } = process.env;

            const result = spawnSync('bun', ['run', script, ...args], {
                cwd: projectRoot,
                encoding: 'utf-8',
                timeout: 25_000,
                env: {
                    ...env,
                    HOME: home,
                    XDG_CONFIG_HOME: join(home, '.config'),
                    GIT_CONFIG_NOSYSTEM: '1',
                },
            });

            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);

            return result.stdout;

        },

        async writeIdentity() {

            const keypair = generateKeyPair();

            await writeFile(keyPath, keypair.privateKey, { mode: 0o600 });
            await chmod(keyPath, 0o600);
            await writeFile(pubPath, keypair.publicKey);
            await writeFile(metadataPath, JSON.stringify({
                identityHash: 'a'.repeat(64),
                name: 'Original Person',
                email: 'original@example.com',
                publicKey: keypair.publicKey,
                machine: 'original-machine',
                os: 'darwin 24.5.0',
                createdAt: '2026-01-01T00:00:00.000Z',
            }));

            return keypair;

        },

        async remove() {

            // A test may have made it read-only, which blocks unlinking its files.
            await chmod(noormHome, 0o700);
            await rm(home, { recursive: true, force: true });
            await rm(projectRoot, { recursive: true, force: true });

        },
    };

}
