/**
 * Tests for checksum verification (`checksum.ts`).
 *
 * `parseChecksums`/`sha256File` are pure and unit-tested directly.
 * `verifyChecksum` is exercised against a real local HTTP server (no fetch
 * mocks) because the behavior under test — `insecure` NEVER bypassing a
 * confirmed mismatch — is the single most important invariant in this
 * ticket; a fixture-driven mock could hide a bug in the actual fetch/compare
 * wiring that only a real request/response round-trip would surface.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { attempt } from '@logosdx/utils';

import { parseChecksums, sha256File, verifyChecksum, ChecksumError } from '../../../src/core/update/checksum.js';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let workDir: string;

const ASSET_NAME = 'noorm-test-asset';

// The "correct" binary bytes and their sha256 — what a legitimate release
// would serve, and what checksums.txt correctly records for it.
const GOOD_PAYLOAD = new Uint8Array(2048).fill(1);
const GOOD_HASH = new Bun.CryptoHasher('sha256').update(GOOD_PAYLOAD).digest('hex');

// Different bytes entirely — simulates a corrupted download or a tampered
// asset: checksums.txt still records GOOD_HASH for ASSET_NAME, but this file
// on disk hashes to something else.
const TAMPERED_PAYLOAD = new Uint8Array(2048).fill(2);
const TAMPERED_HASH = new Bun.CryptoHasher('sha256').update(TAMPERED_PAYLOAD).digest('hex');

let goodFilePath: string;
let tamperedFilePath: string;

beforeAll(async () => {

    workDir = await mkdtemp(join(tmpdir(), 'noorm-checksum-test-'));

    goodFilePath = join(workDir, 'good.bin');
    tamperedFilePath = join(workDir, 'tampered.bin');

    await writeFile(goodFilePath, GOOD_PAYLOAD);
    await writeFile(tamperedFilePath, TAMPERED_PAYLOAD);

    server = Bun.serve({
        port: 0,
        fetch(req) {

            const url = new URL(req.url);

            // Legitimate checksums.txt: records the GOOD hash for ASSET_NAME.
            if (url.pathname === '/checksums.txt') {

                return new Response(`${GOOD_HASH}  ${ASSET_NAME}\n`);

            }

            // Reachable, but has no entry for ASSET_NAME — "can't verify"
            // just like an unreachable file, per the spec's Outline.
            if (url.pathname === '/checksums-no-entry.txt') {

                return new Response(`${GOOD_HASH}  some-other-asset\n`);

            }

            return new Response('not found', { status: 404 });

        },
    });

    baseUrl = `http://localhost:${server.port}`;

});

afterAll(async () => {

    server.stop(true);
    await rm(workDir, { recursive: true, force: true });

});

describe('checksum: parseChecksums', () => {

    it('parses a standard two-space-separated shasum line', () => {

        const map = parseChecksums(`${GOOD_HASH}  ${ASSET_NAME}\n`);

        expect(map[ASSET_NAME]).toBe(GOOD_HASH);

    });

    it('parses the optional `*` binary-mode prefix', () => {

        const map = parseChecksums(`${GOOD_HASH}  *${ASSET_NAME}\n`);

        expect(map[ASSET_NAME]).toBe(GOOD_HASH);

    });

    it('lowercases an uppercase hash', () => {

        const map = parseChecksums(`${GOOD_HASH.toUpperCase()}  ${ASSET_NAME}\n`);

        expect(map[ASSET_NAME]).toBe(GOOD_HASH);

    });

    it('parses multiple lines, one entry per asset', () => {

        const text = `${GOOD_HASH}  asset-one\n${TAMPERED_HASH}  asset-two\n`;
        const map = parseChecksums(text);

        expect(map['asset-one']).toBe(GOOD_HASH);
        expect(map['asset-two']).toBe(TAMPERED_HASH);

    });

    it('skips blank and malformed lines', () => {

        const text = `\n\nnot-a-hash  ${ASSET_NAME}\n${GOOD_HASH}  ${ASSET_NAME}\n\n`;
        const map = parseChecksums(text);

        expect(Object.keys(map)).toHaveLength(1);
        expect(map[ASSET_NAME]).toBe(GOOD_HASH);

    });

});

describe('checksum: sha256File', () => {

    it('computes the sha256 hex digest of a file on disk', async () => {

        const hash = await sha256File(goodFilePath);

        expect(hash).toBe(GOOD_HASH);

    });

    it('produces different digests for different file contents', async () => {

        const hash = await sha256File(tamperedFilePath);

        expect(hash).toBe(TAMPERED_HASH);
        expect(hash).not.toBe(GOOD_HASH);

    });

});

describe('checksum: verifyChecksum', () => {

    it('resolves when the file matches the recorded checksum', async () => {

        const [, err] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/checksums.txt`,
            assetName: ASSET_NAME,
            filePath: goodFilePath,
            insecure: false,
        }));

        expect(err).toBeNull();

    });

    it('throws ChecksumError("mismatch") on a tampered file, and insecure does NOT bypass it', async () => {

        const [, secureErr] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/checksums.txt`,
            assetName: ASSET_NAME,
            filePath: tamperedFilePath,
            insecure: false,
        }));

        expect(secureErr).toBeInstanceOf(ChecksumError);
        if (secureErr instanceof ChecksumError) {

            expect(secureErr.reason).toBe('mismatch');

        }

        // The critical invariant: insecure: true must NOT suppress a confirmed
        // mismatch — unlike the "unreachable" cases below, this throw is
        // unconditional.
        const [, insecureErr] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/checksums.txt`,
            assetName: ASSET_NAME,
            filePath: tamperedFilePath,
            insecure: true,
        }));

        expect(insecureErr).toBeInstanceOf(ChecksumError);
        if (insecureErr instanceof ChecksumError) {

            expect(insecureErr.reason).toBe('mismatch');

        }

    });

    it('throws ChecksumError("unreachable") when checksums.txt 404s and insecure is false', async () => {

        const [, err] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/does-not-exist.txt`,
            assetName: ASSET_NAME,
            filePath: goodFilePath,
            insecure: false,
        }));

        expect(err).toBeInstanceOf(ChecksumError);
        if (err instanceof ChecksumError) {

            expect(err.reason).toBe('unreachable');

        }

    });

    it('resolves without throwing when checksums.txt 404s and insecure is true', async () => {

        const [, err] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/does-not-exist.txt`,
            assetName: ASSET_NAME,
            filePath: goodFilePath,
            insecure: true,
        }));

        expect(err).toBeNull();

    });

    it('treats a checksums.txt with no entry for this asset the same as unreachable', async () => {

        const [, secureErr] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/checksums-no-entry.txt`,
            assetName: ASSET_NAME,
            filePath: goodFilePath,
            insecure: false,
        }));

        expect(secureErr).toBeInstanceOf(ChecksumError);
        if (secureErr instanceof ChecksumError) {

            expect(secureErr.reason).toBe('unreachable');

        }

        const [, insecureErr] = await attempt(() => verifyChecksum({
            checksumsUrl: `${baseUrl}/checksums-no-entry.txt`,
            assetName: ASSET_NAME,
            filePath: goodFilePath,
            insecure: true,
        }));

        expect(insecureErr).toBeNull();

    });

});
