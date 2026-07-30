/**
 * cli: `noorm identity edit` must recompute the identity hash (a08 F10).
 *
 * The identity hash encodes email|name|machine|os. The CLI spread the new
 * name/email over the old record and saved it, leaving a hash that still
 * encoded the PREVIOUS name and email — so `identity list` showed one person
 * while the hash (the value the database joins on, and the value vault access
 * is granted against) still meant another. The TUI's edit screen calls
 * `createIdentityForExistingKeys`, which recomputes it. Same user-facing
 * operation, opposite outcomes per surface.
 *
 * Recomputing costs vault access, because grants are keyed on the old hash.
 * That is inherent to the design, so the command has to say it out loud.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { generateKeyPair } from '../../../src/core/identity/crypto.js';
import { computeIdentityHash } from '../../../src/core/identity/hash.js';
import type { CryptoIdentity } from '../../../src/core/identity/types.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');

describe('cli: identity edit', () => {

    let fakeHome: string;
    let noormDir: string;
    let metadataPath: string;
    let original: CryptoIdentity;

    beforeEach(() => {

        fakeHome = mkdtempSync(join(tmpdir(), 'noorm-identity-edit-home-'));
        noormDir = join(fakeHome, '.noorm');
        mkdirSync(noormDir, { recursive: true });

        const keypair = generateKeyPair();

        writeFileSync(join(noormDir, 'identity.key'), keypair.privateKey, { mode: 0o600 });
        chmodSync(join(noormDir, 'identity.key'), 0o600);
        writeFileSync(join(noormDir, 'identity.pub'), keypair.publicKey, { mode: 0o644 });

        original = {
            identityHash: computeIdentityHash({
                email: 'alice@example.com',
                name: 'Alice Auditor',
                machine: 'alice-laptop',
                os: 'darwin 24.5.0',
            }),
            name: 'Alice Auditor',
            email: 'alice@example.com',
            publicKey: keypair.publicKey,
            machine: 'alice-laptop',
            os: 'darwin 24.5.0',
            createdAt: '2026-01-01T00:00:00Z',
        };

        metadataPath = join(noormDir, 'identity.json');
        writeFileSync(metadataPath, JSON.stringify(original, null, 2));

    });

    afterEach(() => {

        rmSync(fakeHome, { recursive: true, force: true });

    });

    function runEdit(args: string[]) {

        const result = spawnSync(
            'node',
            [CLI, 'identity', 'edit', ...args],
            { cwd: fakeHome, encoding: 'utf-8', env: { ...process.env, HOME: fakeHome } },
        );

        return {
            stdout: typeof result.stdout === 'string' ? result.stdout : '',
            stderr: typeof result.stderr === 'string' ? result.stderr : '',
            status: result.status,
        };

    }

    function storedIdentity(): CryptoIdentity {

        return JSON.parse(readFileSync(metadataPath, 'utf8')) as CryptoIdentity;

    }

    it('recomputes the hash when the name changes', () => {

        const result = runEdit(['--name', 'Bob Victim']);

        expect(result.status).toBe(0);

        const stored = storedIdentity();

        expect(stored.name).toBe('Bob Victim');
        expect(stored.identityHash).toBe(computeIdentityHash({
            email: original.email,
            name: 'Bob Victim',
            machine: stored.machine,
            os: stored.os,
        }));
        expect(stored.identityHash).not.toBe(original.identityHash);

    });

    it('recomputes the hash when the email changes', () => {

        runEdit(['--email', 'bob@corp.internal']);

        const stored = storedIdentity();

        expect(stored.email).toBe('bob@corp.internal');
        expect(stored.identityHash).toBe(computeIdentityHash({
            email: 'bob@corp.internal',
            name: original.name,
            machine: stored.machine,
            os: stored.os,
        }));

    });

    it('preserves the machine so the hash does not silently change twice', () => {

        runEdit(['--name', 'Bob Victim']);

        expect(storedIdentity().machine).toBe(original.machine);

    });

    it('keeps the existing keypair', () => {

        runEdit(['--name', 'Bob Victim']);

        expect(storedIdentity().publicKey).toBe(original.publicKey);

    });

    it('warns that the new hash costs vault access', () => {

        const result = runEdit(['--name', 'Bob Victim']);

        expect(`${result.stdout}${result.stderr}`).toMatch(/vault/i);

    });

    it('reports the new fingerprint in --json', () => {

        const result = runEdit(['--name', 'Bob Victim', '--json']);

        const parsed = JSON.parse(result.stdout.trim()) as { fingerprint: string };

        expect(parsed.fingerprint).toBe(storedIdentity().identityHash);

    });

    it('still requires at least one field', () => {

        const result = runEdit([]);

        expect(result.status).not.toBe(0);

    });

});
