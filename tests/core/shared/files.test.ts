import { describe, it, expect } from 'bun:test';

import {
    filterFilesByPaths,
    findUnmatchedIncludePatterns,
    findUnmatchedExcludePatterns,
} from '../../../src/core/shared/files.js';

describe('shared: filterFilesByPaths', () => {

    it('should include every file when include and exclude are both empty', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/02_views/active.sql',
        ];

        const result = filterFilesByPaths(files, '/project/sql', [], []);

        expect(result).toEqual(files);

    });

    it('should only keep files under an included prefix', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/02_views/active.sql',
        ];

        const result = filterFilesByPaths(files, '/project/sql', ['01_tables'], []);

        expect(result).toEqual(['/project/sql/01_tables/users.sql']);

    });

    it('should let exclude win when a file matches both include and exclude', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/01_tables/archive/old.sql',
        ];

        const result = filterFilesByPaths(files, '/project/sql', ['01_tables'], ['01_tables/archive']);

        expect(result).toEqual(['/project/sql/01_tables/users.sql']);

    });

    it('should exclude a matching prefix even when include is empty (means everything)', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/archive/old.sql',
        ];

        const result = filterFilesByPaths(files, '/project/sql', [], ['archive']);

        expect(result).toEqual(['/project/sql/01_tables/users.sql']);

    });

});

describe('shared: findUnmatchedIncludePatterns', () => {

    it('should return [] when include is empty', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
        ];

        const result = findUnmatchedIncludePatterns(files, '/project/sql', []);

        expect(result).toEqual([]);

    });

    it('should return [] when every pattern matches', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/02_views/active.sql',
        ];

        const result = findUnmatchedIncludePatterns(files, '/project/sql', ['01_tables', '02_views']);

        expect(result).toEqual([]);

    });

    it('should return only the bad pattern among good ones, preserving its original spelling', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/02_views/active.sql',
        ];

        const result = findUnmatchedIncludePatterns(
            files,
            '/project/sql',
            ['01_tables', '03_Functions'],
        );

        expect(result).toEqual(['03_Functions']);

    });

    it('should report the sql/-prefix mistake as unmatched (the real-world case)', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
        ];

        const result = findUnmatchedIncludePatterns(files, '/project/sql', ['sql/01_tables']);

        expect(result).toEqual(['sql/01_tables']);

    });

    it('should match a nested pattern that has a corresponding file', () => {

        const files = [
            '/project/sql/06_seeds/cron/every-minute.sql',
        ];

        const result = findUnmatchedIncludePatterns(files, '/project/sql', ['06_seeds/cron']);

        expect(result).toEqual([]);

    });

    it('should treat leading ./ and trailing / forms as unmatched (documented current behavior)', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
        ];

        const result = findUnmatchedIncludePatterns(
            files,
            '/project/sql',
            ['./01_tables', '01_tables/'],
        );

        expect(result).toEqual(['./01_tables', '01_tables/']);

    });

    it('should match a pattern equal to a file path, not just a directory prefix', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
        ];

        const result = findUnmatchedIncludePatterns(files, '/project/sql', ['01_tables/users.sql']);

        expect(result).toEqual([]);

    });

});

/**
 * The unmatched-*exclude* case is the dangerous direction. A bad `include`
 * over-restricts and you notice, because nothing ran. A bad `exclude`
 * under-restricts: the seeds, fixtures or destructive DDL you fenced off
 * execute against the target database, and the build reports success.
 */
describe('shared: findUnmatchedExcludePatterns', () => {

    it('should name an exclude entry that matched nothing', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/10_seeds/data.sql',
        ];

        // The same `sql/` prefix mistake the include warning exists for:
        // patterns are relative to paths.sql, so this means sql/sql/10_seeds.
        const result = findUnmatchedExcludePatterns(files, '/project/sql', ['sql/10_seeds']);

        expect(result).toEqual(['sql/10_seeds']);

    });

    it('should report nothing when every exclude entry matched', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/10_seeds/data.sql',
        ];

        const result = findUnmatchedExcludePatterns(files, '/project/sql', ['10_seeds']);

        expect(result).toEqual([]);

    });

    it('should report only the entries that matched nothing', () => {

        const files = [
            '/project/sql/01_tables/users.sql',
            '/project/sql/10_seeds/data.sql',
        ];

        const result = findUnmatchedExcludePatterns(
            files,
            '/project/sql',
            ['10_seeds', '99_archive'],
        );

        expect(result).toEqual(['99_archive']);

    });

    it('should report nothing for an empty exclude list', () => {

        const files = ['/project/sql/01_tables/users.sql'];

        expect(findUnmatchedExcludePatterns(files, '/project/sql', [])).toEqual([]);

    });

    it('should report every entry when no files were discovered at all', () => {

        // Nothing to fence off, so nothing is at risk — but the entry is
        // still wrong, and staying silent is how it survives to the build
        // where files do exist.
        expect(findUnmatchedExcludePatterns([], '/project/sql', ['10_seeds'])).toEqual(['10_seeds']);

    });

});
