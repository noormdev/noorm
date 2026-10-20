/**
 * The subprocess runs the dist build, whose version is 0.0.0-dev, so the
 * update check answers "up to date" without touching the network.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdir } from 'node:fs/promises';

import { downloadProgressRenderer, updateStatus } from '../../src/cli/update.js';
import { TMP_BASE, cleanupProject, runCli, setupProject, type TestProject } from './run/_setup.js';

const MB = 1024 * 1024;

describe('cli: update status lines', () => {

    function status(opts: { isTty: boolean; json: boolean }) {

        const writes: string[] = [];

        return { writes, status: updateStatus((text) => writes.push(text), opts) };

    }

    it('should replace a pending line in place on a terminal', () => {

        const { writes, status: lines } = status({ isTty: true, json: false });

        lines.pending('Checking for updates...');
        lines.say('Update available: 1.5.0 → 1.5.1');

        expect(writes[0]).toBe('Checking for updates...');
        expect(writes[1]?.startsWith('\rUpdate available: 1.5.0 → 1.5.1')).toBe(true);
        expect(writes[1]?.endsWith('\n')).toBe(true);

    });

    it('should print every line in full off a terminal', () => {

        const { writes, status: lines } = status({ isTty: false, json: false });

        lines.pending('Checking for updates...');
        lines.say('Update available: 1.5.0 → 1.5.1');

        expect(writes).toEqual(['Checking for updates...\n', 'Update available: 1.5.0 → 1.5.1\n']);

    });

    it('should print nothing under --json', () => {

        const { writes, status: lines } = status({ isTty: false, json: true });

        lines.pending('Checking for updates...');
        lines.say('Already on the latest version (1.5.1)');
        lines.endLine();

        expect(writes).toEqual([]);

    });

    // A resumed download keeps the progress it had, so the notice must not overwrite it.
    it('should put a retry notice on its own line below the download line', () => {

        const { writes, status: lines } = status({ isTty: true, json: false });
        const render = downloadProgressRenderer(lines.raw, true);

        render?.({ received: 5 * MB, total: 10 * MB });
        lines.endLine();
        lines.say('download stalled — resuming (attempt 2/5)...');

        expect(writes[1]).toBe('\n');
        expect(writes[2]).toBe('download stalled — resuming (attempt 2/5)...\n');

    });

    it('should end an open download line before an error, and add nothing once it is closed', () => {

        const { writes, status: lines } = status({ isTty: true, json: false });
        const render = downloadProgressRenderer(lines.raw, true);

        render?.({ received: 5 * MB, total: 10 * MB });
        lines.endLine();
        lines.endLine();

        expect(writes.slice(1)).toEqual(['\n']);

    });

});

describe('cli: update download progress', () => {

    function render(isTty: boolean) {

        const writes: string[] = [];
        const renderer = downloadProgressRenderer((text) => writes.push(text), isTty);

        return { writes, renderer };

    }

    it('should render nothing off a terminal, where every tick would be its own line', () => {

        expect(render(false).renderer).toBeNull();

    });

    it('should rewrite one line in place while the download runs', () => {

        const { writes, renderer } = render(true);

        renderer?.({ received: 5 * MB, total: 10 * MB });
        renderer?.({ received: 6 * MB, total: 10 * MB });

        expect(writes[0]?.startsWith('\rDownloading 5.0 / 10.0 MB (50%)')).toBe(true);
        expect(writes[1]?.startsWith('\rDownloading 6.0 / 10.0 MB (60%)')).toBe(true);
        expect(writes.some((text) => text.includes('\n'))).toBe(false);

    });

    // A rewrite shorter than the line it replaces must not leave its tail behind.
    it('should pad every rewrite to the same width', () => {

        const { writes, renderer } = render(true);

        renderer?.({ received: 999 * MB, total: 1000 * MB });
        renderer?.({ received: 1 * MB, total: 0 });

        expect(writes[1]?.length).toBe(writes[0]?.length);

    });

    it('should end on a Downloaded line and ignore ticks after it', () => {

        const { writes, renderer } = render(true);

        renderer?.({ received: 10 * MB, total: 10 * MB });
        renderer?.({ received: 10 * MB, total: 10 * MB });

        expect(writes).toHaveLength(1);
        expect(writes[0]?.startsWith('\rDownloaded 10.0 MB (100%)')).toBe(true);
        expect(writes[0]?.endsWith('\n')).toBe(true);

    });

    it('should show megabytes alone when the size is unknown', () => {

        const { writes, renderer } = render(true);

        renderer?.({ received: 3 * MB, total: 0 });

        expect(writes[0]?.startsWith('\rDownloading 3.0 MB')).toBe(true);
        expect(writes[0]).not.toContain('%');

    });

});

describe('cli: update --json', () => {

    let project: TestProject;

    beforeAll(async () => {

        await mkdir(TMP_BASE, { recursive: true });

    });

    beforeEach(async () => {

        project = await setupProject();

    });

    afterEach(async () => {

        await cleanupProject(project);

    });

    // Status lines printed ahead of the document made `noorm update --json | jq` fail.
    it('should write exactly one JSON document to stdout', () => {

        const { stdout, status } = runCli(project, ['update', '--json']);

        const payload = JSON.parse(stdout);

        expect(status).toBe(0);
        expect(payload).toMatchObject({ success: true, updateAvailable: false, installed: false });

    });

});
