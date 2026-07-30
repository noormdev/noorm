/**
 * Tests for export path resolution utilities.
 */
import { describe, it, expect } from 'bun:test';
import { attempt } from '@logosdx/utils';

import {
    resolveExportExtension,
    resolveExportPath,
    resolveExportTables,
} from '../../../src/core/dt/paths.js';

describe('resolveExportTables', () => {

    const listTables = async () => [{ name: 'users' }, { name: 'posts' }];

    // `--tables` describes itself as "(default: all)". Omitting it resolved
    // to [], so `--export ./out` wrote no files, printed {"success":true} and
    // exited 0 — a backup that looks like it happened.
    it('should default to every table when no selection is given', async () => {

        expect(await resolveExportTables(undefined, listTables)).toEqual(['users', 'posts']);

    });

    it('should honour an explicit selection', async () => {

        expect(await resolveExportTables(['posts'], listTables)).toEqual(['posts']);

    });

    it('should fail rather than export nothing from an empty database', async () => {

        const [tables, err] = await attempt(() => resolveExportTables(undefined, async () => []));

        expect(tables).toBeNull();
        expect(err!.message).toMatch(/No tables found/);

    });

    it('should fail on an explicitly empty selection', async () => {

        const [tables, err] = await attempt(() => resolveExportTables([], listTables));

        expect(tables).toBeNull();
        expect(err!.message).toMatch(/--tables was empty/);

    });

});

describe('resolveExportExtension', () => {

    it('returns .dt by default', () => {

        expect(resolveExportExtension(false)).toBe('.dt');

    });

    it('returns .dtz when compress is true', () => {

        expect(resolveExportExtension(true)).toBe('.dtz');

    });

    it('returns .dtzx when passphrase is provided', () => {

        expect(resolveExportExtension(false, 'secret')).toBe('.dtzx');
        expect(resolveExportExtension(true, 'secret')).toBe('.dtzx');

    });

    it('passphrase takes precedence over compress', () => {

        // Even with compress=false, passphrase wins
        expect(resolveExportExtension(false, 'secret')).toBe('.dtzx');

    });

});

describe('resolveExportPath', () => {

    describe('single table', () => {

        it('uses path as-is when it has a recognized extension', () => {

            expect(resolveExportPath({
                exportPath: './backup/users.dt',
                tableName: 'users',
                tableCount: 1,
                ext: '.dt',
            })).toBe('./backup/users.dt');

            expect(resolveExportPath({
                exportPath: './backup/users.dtz',
                tableName: 'users',
                tableCount: 1,
                ext: '.dtz',
            })).toBe('./backup/users.dtz');

            expect(resolveExportPath({
                exportPath: './backup/users.dtzx',
                tableName: 'users',
                tableCount: 1,
                ext: '.dtzx',
            })).toBe('./backup/users.dtzx');

        });

        it('appends extension when path has no recognized extension', () => {

            expect(resolveExportPath({
                exportPath: './backup/users',
                tableName: 'users',
                tableCount: 1,
                ext: '.dt',
            })).toBe('./backup/users.dt');

            expect(resolveExportPath({
                exportPath: './backup/users',
                tableName: 'users',
                tableCount: 1,
                ext: '.dtz',
            })).toBe('./backup/users.dtz');

        });

        it('keeps other extensions and appends', () => {

            // If someone specifies a weird extension, we append
            expect(resolveExportPath({
                exportPath: './backup/users.json',
                tableName: 'users',
                tableCount: 1,
                ext: '.dt',
            })).toBe('./backup/users.json.dt');

        });

    });

    describe('multiple tables', () => {

        it('treats path as directory and generates filename', () => {

            expect(resolveExportPath({
                exportPath: './backup/',
                tableName: 'users',
                tableCount: 3,
                ext: '.dt',
            })).toBe('backup/users.dt');

            expect(resolveExportPath({
                exportPath: './backup/',
                tableName: 'posts',
                tableCount: 3,
                ext: '.dtz',
            })).toBe('backup/posts.dtz');

        });

        it('works with directories without trailing slash', () => {

            expect(resolveExportPath({
                exportPath: './backup',
                tableName: 'users',
                tableCount: 3,
                ext: '.dt',
            })).toBe('backup/users.dt');

        });

    });

});
