import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SettingsManager } from '../../../src/core/settings/manager.js';

describe('core: SettingsManager.setTeardown', () => {

    let tmpDir: string;

    beforeEach(() => {

        tmpDir = mkdtempSync(join(tmpdir(), 'noorm-set-teardown-'));
        mkdirSync(join(tmpDir, '.noorm'), { recursive: true });
        writeFileSync(
            join(tmpDir, '.noorm', 'settings.yml'),
            'paths:\n    sql: ./sql\n    changes: ./changes\n',
        );

    });

    afterEach(() => {

        rmSync(tmpDir, { recursive: true, force: true });

    });

    it('writes teardown config to disk and is readable on reload', async () => {

        const manager = new SettingsManager(tmpDir);
        await manager.load();

        await manager.setTeardown({
            preserveTables: ['AppSettings', 'UserRoles'],
            postScript: 'sql/teardown/cleanup.sql',
        });

        const onDisk = readFileSync(join(tmpDir, '.noorm', 'settings.yml'), 'utf-8');
        expect(onDisk).toContain('preserveTables');
        expect(onDisk).toContain('AppSettings');
        expect(onDisk).toContain('cleanup.sql');

        const fresh = new SettingsManager(tmpDir);
        await fresh.load();
        const teardown = fresh.settings.teardown;

        expect(teardown?.preserveTables).toEqual(['AppSettings', 'UserRoles']);
        expect(teardown?.postScript).toBe('sql/teardown/cleanup.sql');

    });

    it('overwrites previous teardown config on subsequent setTeardown calls', async () => {

        const manager = new SettingsManager(tmpDir);
        await manager.load();

        await manager.setTeardown({ preserveTables: ['A'] });
        await manager.setTeardown({ preserveTables: ['B', 'C'] });

        const fresh = new SettingsManager(tmpDir);
        await fresh.load();

        expect(fresh.settings.teardown?.preserveTables).toEqual(['B', 'C']);

    });

    it('clears teardown when called with an empty object', async () => {

        const manager = new SettingsManager(tmpDir);
        await manager.load();

        await manager.setTeardown({ preserveTables: ['A'] });
        await manager.setTeardown({});

        const fresh = new SettingsManager(tmpDir);
        await fresh.load();

        // {} is a valid teardown config that opts everything back to defaults
        expect(fresh.settings.teardown).toEqual({});

    });

});
