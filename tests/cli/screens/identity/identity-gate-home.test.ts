/**
 * The identity gate against real key files, in a throwaway HOME.
 *
 * The in-process gate tests replace `~/.noorm` with a stand-in, because the
 * path is fixed when the storage module loads. These run the real modules in a
 * child process instead, for the two cases where the stand-in would only be
 * testing itself: what happens to the bytes of an existing key, and what the
 * gate says about a key file the state manager refused to load.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { generateKeyPair } from '../../../../src/core/identity/crypto.js';
import { createThrowawayHome, type ThrowawayHome } from '../../fixtures/throwaway-home.js';

const GATE = join(import.meta.dir, '..', '..', 'fixtures', 'identity-gate-home.tsx');
const STATE = join(import.meta.dir, '..', '..', '..', 'core', 'identity', 'fixtures', 'ensure-identity-home.ts');

describe('cli: identity gate with real key files', () => {

    let home: ThrowawayHome;

    beforeEach(async () => {

        home = await createThrowawayHome();

    });

    afterEach(async () => {

        await home.remove();

    });

    const run = (script: string, mode: string): string => home.run(script, mode, home.projectRoot);

    it('should complete setup around a lone private key without changing it', async () => {

        const keypair = generateKeyPair();

        await writeFile(home.keyPath, keypair.privateKey, { mode: 0o600 });
        await chmod(home.keyPath, 0o600);
        run(STATE, 'seed');

        const keyBytes = await readFile(home.keyPath);
        const frame = run(GATE, 'continue');

        expect(frame).toContain('the screen behind the gate');
        expect((await readFile(home.keyPath)).equals(keyBytes)).toBe(true);
        expect(await readFile(home.pubPath, 'utf8')).toBe(keypair.publicKey);
        expect(JSON.parse(await readFile(home.metadataPath, 'utf8')).email).toBe('git@example.com');
        expect(run(STATE, 'read')).toBe('legacy_db');

    }, 30_000);

    it('should report a group-readable key instead of offering setup, and leave the identity alone', async () => {

        const keypair = generateKeyPair();
        const metadata = JSON.stringify({
            identityHash: 'a'.repeat(64),
            name: 'Original Person',
            email: 'original@example.com',
            publicKey: keypair.publicKey,
            machine: 'original-machine',
            os: 'darwin 24.5.0',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        await writeFile(home.keyPath, keypair.privateKey, { mode: 0o644 });
        await chmod(home.keyPath, 0o644);
        await writeFile(home.pubPath, keypair.publicKey);
        await writeFile(home.metadataPath, metadata);

        const frame = run(GATE, 'show').replace(/[│\s]+/g, ' ');

        expect(frame).toContain('Insecure permissions on private key file');
        expect(frame).toContain('chmod 600');
        expect(frame).not.toContain('Welcome to noorm');
        expect(frame).not.toContain('[ Continue ]');
        expect(await readFile(home.keyPath, 'utf8')).toBe(keypair.privateKey);
        expect(await readFile(home.metadataPath, 'utf8')).toBe(metadata);
        const [, missing] = await attempt(() => access(join(home.projectRoot, '.noorm', 'state', 'state.enc')));
        expect(missing).toBeInstanceOf(Error);

    }, 30_000);

});
