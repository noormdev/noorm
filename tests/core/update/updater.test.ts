/**
 * Tests for the binary-download path of the updater.
 *
 * These exercise the real streaming download (`downloadToFile`) against a live
 * local HTTP server — no fetch/fs mocks — because the regressions we care about
 * are behavioral: does it stream to disk, does it report progress, and does it
 * fail (rather than hang forever) when the connection stalls? The `installUpdate`
 * swap step is deliberately not tested here: in a test process `process.execPath`
 * is the test runner's own binary, and swapping it would be catastrophic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readFile, stat, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { attempt } from '@logosdx/utils';

import { downloadToFile } from '../../../src/core/update/updater.js';
import { observer } from '../../../src/core/observer.js';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let workDir: string;

// A payload large enough to cross the progress-emit threshold (512 KiB) a few
// times, so we can assert on real chunked progress rather than a single tick.
const PAYLOAD = new Uint8Array(1_500_000).fill(65); // 1.5 MB of 'A'

beforeAll(async () => {

    workDir = await mkdtemp(join(tmpdir(), 'noorm-updater-test-'));

    server = Bun.serve({
        port: 0,
        async fetch(req) {

            const url = new URL(req.url);

            // Healthy download with a correct Content-Length.
            if (url.pathname === '/ok') {

                return new Response(PAYLOAD, {
                    headers: { 'content-length': String(PAYLOAD.byteLength) },
                });

            }

            // Sends headers + a first chunk, then holds the stream open forever
            // without sending more — the exact "connected but stalled" case a
            // bare fetch() would hang on.
            if (url.pathname === '/stall') {

                const stream = new ReadableStream({
                    start(controller) {

                        controller.enqueue(new Uint8Array(1024).fill(66));
                        // never close, never enqueue again

                    },
                });

                return new Response(stream, {
                    headers: { 'content-length': String(PAYLOAD.byteLength) },
                });

            }

            if (url.pathname === '/notfound') {

                return new Response('nope', { status: 404 });

            }

            return new Response('unknown', { status: 500 });

        },
    });

    baseUrl = `http://localhost:${server.port}`;

});

afterAll(async () => {

    server.stop(true);
    await rm(workDir, { recursive: true, force: true });

});

describe('downloadToFile', () => {

    it('streams the full body to disk and makes it executable', async () => {

        const dest = join(workDir, 'ok.bin');

        await downloadToFile(`${baseUrl}/ok`, dest, '1.0.0-test');

        const written = await readFile(dest);
        expect(written.byteLength).toBe(PAYLOAD.byteLength);
        expect(written[0]).toBe(65);

        // chmod 0o755 — owner-executable bit must be set
        const info = await stat(dest);
        expect(info.mode & 0o111).not.toBe(0);

    });

    it('emits monotonic progress that reaches the total', async () => {

        const dest = join(workDir, 'progress.bin');
        const ticks: Array<{ received: number; total: number }> = [];

        const onProgress = (p: { version: string; received: number; total: number }) => {

            ticks.push({ received: p.received, total: p.total });

        };

        observer.on('update:progress', onProgress);
        await downloadToFile(`${baseUrl}/ok`, dest, '1.0.0-test');
        observer.off('update:progress', onProgress);

        expect(ticks.length).toBeGreaterThan(1); // real chunked progress, not one tick

        // received is non-decreasing
        for (let i = 1; i < ticks.length; i++) {

            expect(ticks[i]!.received).toBeGreaterThanOrEqual(ticks[i - 1]!.received);

        }

        // the last tick reports the full payload against the advertised total
        const last = ticks[ticks.length - 1]!;
        expect(last.received).toBe(PAYLOAD.byteLength);
        expect(last.total).toBe(PAYLOAD.byteLength);

    });

    it('aborts with a "stalled" error instead of hanging when the stream stops', async () => {

        const dest = join(workDir, 'stall.bin');

        const start = performance.now();
        const [, err] = await attempt(() => downloadToFile(`${baseUrl}/stall`, dest, '1.0.0-test', 300));
        const elapsed = performance.now() - start;

        expect(err).toBeTruthy();
        expect(err!.message).toContain('stalled');
        // proves it did not hang: bounded by the injected 300ms stall window
        expect(elapsed).toBeLessThan(3000);

    });

    it('rejects a non-OK response with the status code', async () => {

        const dest = join(workDir, 'nf.bin');

        const [, err] = await attempt(() => downloadToFile(`${baseUrl}/notfound`, dest, '1.0.0-test'));

        expect(err).toBeTruthy();
        expect(err!.message).toContain('404');

    });

});
