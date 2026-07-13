/**
 * Tests for the binary-download path of the updater.
 *
 * These exercise the real streaming download (`downloadToFile`) against a live
 * local HTTP server — no fetch/fs mocks — because the regressions we care about
 * are behavioral: does it stream to disk, report progress, resume from a stall
 * via a range request, and fail (rather than hang) once retries run out? The
 * `installUpdate` swap step is deliberately not tested here: in a test process
 * `process.execPath` is the test runner's own binary, and swapping it would be
 * catastrophic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readFile, stat, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { attempt, wait } from '@logosdx/utils';

import { downloadToFile } from '../../../src/core/update/updater.js';
import { observer } from '../../../src/core/observer.js';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let workDir: string;

// A payload large enough to cross the progress-emit threshold (512 KiB) a few
// times, so we can assert on real chunked progress rather than a single tick.
const PAYLOAD = new Uint8Array(1_500_000).fill(65); // 1.5 MB of 'A'

// How much /resume streams before it stalls on the first request.
const RESUME_PARTIAL = 700_000;
const RESUME_ETAG = '"asset-v1"';

// Range headers seen by /resume, so a test can prove the second attempt resumed
// (sent a byte range) rather than restarting from scratch.
let resumeRanges: Array<string | null> = [];

// 128 KiB — enough to force multiple pull() cycles for the 1.5 MB PAYLOAD, so
// the mock server delivers a body over several ticks instead of one
// native-buffered blob. A single-tick, instantly-complete body is what
// triggers a Bun runtime race in `for await` iteration over `response.body`
// (see docs/spec/v1-37-updater-flake.md, "Root-cause hypothesis and
// evidence") — this keeps the streaming tests deterministic without
// touching production code.
const CHUNK_SIZE = 128 * 1024;

/**
 * Streams `data` out in bounded pieces via a pull()-based ReadableStream,
 * yielding cooperatively between enqueues so consumers see the body arrive
 * over multiple ticks rather than as one instantly-complete chunk.
 *
 * @example
 * new Response(chunkedStream(PAYLOAD));
 */
function chunkedStream(data: Uint8Array, chunkSize = CHUNK_SIZE): ReadableStream<Uint8Array> {

    let offset = 0;

    return new ReadableStream({
        async pull(controller) {

            if (offset >= data.byteLength) {

                controller.close();

                return;

            }

            const end = Math.min(offset + chunkSize, data.byteLength);
            controller.enqueue(data.slice(offset, end));
            offset = end;

            await wait(0);

        },
    });

}

beforeAll(async () => {

    workDir = await mkdtemp(join(tmpdir(), 'noorm-updater-test-'));

    server = Bun.serve({
        port: 0,
        async fetch(req) {

            const url = new URL(req.url);

            // Healthy download with a correct Content-Length.
            if (url.pathname === '/ok') {

                return new Response(chunkedStream(PAYLOAD), {
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

            // Resumable asset. First request (no Range): 200 with an ETag,
            // streams a partial prefix, then stalls. A subsequent Range request:
            // 206 with the remainder, so the download completes on resume.
            if (url.pathname === '/resume') {

                const range = req.headers.get('range');
                resumeRanges.push(range);

                if (!range) {

                    const stream = new ReadableStream({
                        start(controller) {

                            controller.enqueue(PAYLOAD.slice(0, RESUME_PARTIAL));
                            // stall — never enqueue the rest, never close

                        },
                    });

                    return new Response(stream, {
                        headers: {
                            'content-length': String(PAYLOAD.byteLength),
                            etag: RESUME_ETAG,
                        },
                    });

                }

                const startByte = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);

                return new Response(chunkedStream(PAYLOAD.slice(startByte)), {
                    status: 206,
                    headers: {
                        etag: RESUME_ETAG,
                        'content-range': `bytes ${startByte}-${PAYLOAD.byteLength - 1}/${PAYLOAD.byteLength}`,
                        'content-length': String(PAYLOAD.byteLength - startByte),
                    },
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

describe('updater: downloadToFile', () => {

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

    it('resumes from the partial via a range request after a stall', async () => {

        resumeRanges = [];
        const dest = join(workDir, 'resume.bin');
        const retries: Array<{ attempt: number; maxAttempts: number }> = [];

        const onRetry = (r: { attempt: number; maxAttempts: number }) => {

            retries.push({ attempt: r.attempt, maxAttempts: r.maxAttempts });

        };

        observer.on('update:retry', onRetry);
        await downloadToFile(`${baseUrl}/resume`, dest, '1.0.0-test', { stallMs: 300, backoffMs: 20 });
        observer.off('update:retry', onRetry);

        // The file is whole and correct despite the mid-stream stall.
        const written = await readFile(dest);
        expect(written.byteLength).toBe(PAYLOAD.byteLength);
        expect(written.every((b) => b === 65)).toBe(true);

        // It retried once...
        expect(retries.length).toBe(1);

        // ...and the retry was a RESUME: first request had no Range, the second
        // asked for exactly the bytes already on disk — not a fresh restart.
        expect(resumeRanges[0]).toBeNull();
        expect(resumeRanges[1]).toBe(`bytes=${RESUME_PARTIAL}-`);

    });

    it('aborts with a "stalled" error instead of hanging when the stream stops', async () => {

        const dest = join(workDir, 'stall.bin');

        const start = performance.now();
        const [, err] = await attempt(() =>
            downloadToFile(`${baseUrl}/stall`, dest, '1.0.0-test', { stallMs: 200, maxAttempts: 1 }),
        );
        const elapsed = performance.now() - start;

        expect(err).toBeTruthy();
        expect(err!.message).toContain('stalled');
        // proves it did not hang: one attempt, bounded by the 200ms stall window
        expect(elapsed).toBeLessThan(3000);

    });

    it('gives up after exhausting the retry budget on a persistent stall', async () => {

        const dest = join(workDir, 'give-up.bin');
        let retryCount = 0;

        const onRetry = () => {

            retryCount++;

        };

        observer.on('update:retry', onRetry);
        const [, err] = await attempt(() =>
            downloadToFile(`${baseUrl}/stall`, dest, '1.0.0-test', { stallMs: 150, maxAttempts: 3, backoffMs: 10 }),
        );
        observer.off('update:retry', onRetry);

        expect(err).toBeTruthy();
        expect(err!.message).toContain('stalled');
        // 3 attempts → 2 retry notices between them
        expect(retryCount).toBe(2);

    });

    it('does not retry a non-retriable 404', async () => {

        const dest = join(workDir, 'nf.bin');
        let retryCount = 0;

        const onRetry = () => {

            retryCount++;

        };

        observer.on('update:retry', onRetry);
        const [, err] = await attempt(() => downloadToFile(`${baseUrl}/notfound`, dest, '1.0.0-test'));
        observer.off('update:retry', onRetry);

        expect(err).toBeTruthy();
        expect(err!.message).toContain('404');
        expect(retryCount).toBe(0); // 4xx is permanent — fail fast, no retries

    });

});
