/**
 * Identity regeneration in the TUI against real key files, in a throwaway
 * HOME. The old key file is the only way back to existing state, so these
 * check its bytes on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { chmod, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createThrowawayHome, type ThrowawayHome } from '../../fixtures/throwaway-home.js';

const REGENERATE = join(import.meta.dir, '..', '..', 'fixtures', 'identity-regenerate-home.tsx');

/** The frame as one string without borders or wrapping, so a wrapped path still matches. */
const unwrapped = (frame: string): string => frame.replace(/[│\s]+/g, '');

describe('cli: identity regeneration with real key files', () => {

    let home: ThrowawayHome;

    beforeEach(async () => {

        home = await createThrowawayHome();

    });

    afterEach(async () => {

        await home.remove();

    });

    const regenerate = (): { warning: string; result: string } => JSON.parse(home.run(REGENERATE));

    it('should back up the old private key before replacing it, and say where', async () => {

        const old = await home.writeIdentity();

        const { warning, result } = regenerate();

        const backups = (await readdir(home.noormHome)).filter((name) => name.startsWith('identity.key.bak-'));

        expect(backups).toHaveLength(1);

        const backupPath = join(home.noormHome, backups[0]!);

        expect(await readFile(backupPath, 'utf8')).toBe(old.privateKey);
        expect(await readFile(home.keyPath, 'utf8')).not.toBe(old.privateKey);

        expect(unwrapped(warning)).toContain('becomespermanentlyundecryptable');
        expect(unwrapped(warning)).toContain('.bak-<timestamp>');
        expect(unwrapped(result)).toContain(unwrapped(backupPath));
        expect(unwrapped(result)).toContain('Restoreidentity.keyfromthatbackuptoregainaccesstoexistingstate.');

    }, 30_000);

    it('should refuse to regenerate when the backup cannot be written', async () => {

        const old = await home.writeIdentity();
        const metadata = await readFile(home.metadataPath, 'utf8');

        // Existing files stay writable in a read-only directory, so only the
        // backup is blocked: without it the key would be overwritten.
        await chmod(home.noormHome, 0o500);

        const { result } = regenerate();

        expect(unwrapped(result)).toContain('Refusingtooverwrite:couldnotbackuptheexistingidentity');
        expect(await readFile(home.keyPath, 'utf8')).toBe(old.privateKey);
        expect(await readFile(home.pubPath, 'utf8')).toBe(old.publicKey);
        expect(await readFile(home.metadataPath, 'utf8')).toBe(metadata);

    }, 30_000);

    // The key is written before the metadata, so by the time this fails the old key exists only in the backup.
    it('should say where the backup is when creation fails after it was written', async () => {

        const old = await home.writeIdentity();

        await chmod(home.metadataPath, 0o400);

        const { result } = regenerate();

        const backups = (await readdir(home.noormHome)).filter((name) => name.startsWith('identity.key.bak-'));

        expect(backups).toHaveLength(1);
        expect(await readFile(join(home.noormHome, backups[0]!), 'utf8')).toBe(old.privateKey);
        expect(unwrapped(result)).toContain(unwrapped(join(home.noormHome, backups[0]!)));
        expect(unwrapped(result)).not.toContain('IdentityRegenerated');

    }, 30_000);

});
