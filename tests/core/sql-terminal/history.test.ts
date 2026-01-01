import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

import { SqlHistoryManager } from '../../../src/core/sql-terminal/history.js';

import type {
    SqlExecutionResult,
    SqlHistoryEntrySerialized,
} from '../../../src/core/sql-terminal/types.js';

const gzipAsync = promisify(gzip);

const TMP_DIR = join(import.meta.dirname, '..', '..', 'tmp', 'sql-history-test');

describe('sql-terminal: history', () => {

    beforeEach(async () => {

        await rm(TMP_DIR, { recursive: true, force: true });
        await mkdir(TMP_DIR, { recursive: true });

    });

    afterAll(async () => {

        await rm(TMP_DIR, { recursive: true, force: true });

    });

    describe('SqlHistoryManager', () => {

        describe('load', () => {

            it('should return empty array when file does not exist', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const entries = await manager.load();

                expect(entries).toEqual([]);

            });

            it('should return empty array when file contains corrupted JSON', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, '{ invalid json }', 'utf-8');

                const entries = await manager.load();

                expect(entries).toEqual([]);

            });

            it('should deserialize Date objects correctly', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                const now = new Date();
                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'test-id-1',
                            query: 'SELECT 1',
                            executedAt: now.toISOString(),
                            durationMs: 100,
                            success: true,
                            rowCount: 1,
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const entries = await manager.load();

                expect(entries).toHaveLength(1);
                expect(entries[0].id).toBe('test-id-1');
                expect(entries[0].executedAt).toBeInstanceOf(Date);
                expect(entries[0].executedAt.toISOString()).toBe(now.toISOString());

            });

            it('should load multiple entries', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'test-id-1',
                            query: 'SELECT 1',
                            executedAt: new Date().toISOString(),
                            durationMs: 100,
                            success: true,
                            rowCount: 1,
                        },
                        {
                            id: 'test-id-2',
                            query: 'SELECT 2',
                            executedAt: new Date().toISOString(),
                            durationMs: 200,
                            success: true,
                            rowCount: 1,
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const entries = await manager.load();

                expect(entries).toHaveLength(2);
                expect(entries[0].id).toBe('test-id-1');
                expect(entries[1].id).toBe('test-id-2');

            });

            it('should preserve optional fields', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'test-id-1',
                            query: 'SELECT * FROM invalid',
                            executedAt: new Date().toISOString(),
                            durationMs: 50,
                            success: false,
                            errorMessage: 'Table not found',
                        },
                        {
                            id: 'test-id-2',
                            query: 'SELECT 1',
                            executedAt: new Date().toISOString(),
                            durationMs: 100,
                            success: true,
                            rowCount: 1,
                            resultsFile: 'test-id-2.results.gz',
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const entries = await manager.load();

                expect(entries).toHaveLength(2);
                expect(entries[0].errorMessage).toBe('Table not found');
                expect(entries[1].resultsFile).toBe('test-id-2.results.gz');

            });

        });

        describe('addEntry', () => {

            it('should create UUID for new entry', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                const id = await manager.addEntry('INSERT INTO users VALUES (1)', result);

                expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

            });

            it('should prepend to history (newest first)', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result1: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                const result2: SqlExecutionResult = {
                    success: true,
                    durationMs: 200,
                    rowsAffected: 2,
                };

                const id1 = await manager.addEntry('SELECT 1', result1);
                const id2 = await manager.addEntry('SELECT 2', result2);

                const entries = await manager.load();

                expect(entries).toHaveLength(2);
                expect(entries[0].id).toBe(id2);
                expect(entries[1].id).toBe(id1);

            });

            it('should save gzipped results when rows present', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id', 'name'],
                    rows: [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Bob' },
                    ],
                };

                const id = await manager.addEntry('SELECT * FROM users', result);

                const entries = await manager.load();

                expect(entries[0].resultsFile).toBe(`${id}.results.gz`);

                const resultsDir = join(TMP_DIR, '.noorm', 'sql-history', 'test-config');
                const files = await readdir(resultsDir);

                expect(files).toContain(`${id}.results.gz`);

            });

            it('should not save results file when no rows', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 50,
                    rowsAffected: 1,
                };

                await manager.addEntry('INSERT INTO users VALUES (1)', result);

                const entries = await manager.load();

                expect(entries[0].resultsFile).toBeUndefined();

            });

            it('should not save results file when empty rows array', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 50,
                    columns: ['id'],
                    rows: [],
                };

                await manager.addEntry('SELECT * FROM users WHERE 1=0', result);

                const entries = await manager.load();

                expect(entries[0].resultsFile).toBeUndefined();

            });

            it('should save error entries without results file', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: false,
                    durationMs: 50,
                    errorMessage: 'Syntax error',
                };

                await manager.addEntry('SELECT * FROM', result);

                const entries = await manager.load();

                expect(entries).toHaveLength(1);
                expect(entries[0].success).toBe(false);
                expect(entries[0].errorMessage).toBe('Syntax error');
                expect(entries[0].resultsFile).toBeUndefined();

            });

            it('should use rowCount from rows.length when available', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id'],
                    rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
                };

                await manager.addEntry('SELECT * FROM users', result);

                const entries = await manager.load();

                expect(entries[0].rowCount).toBe(3);

            });

            it('should use rowCount from rowsAffected when no rows', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 50,
                    rowsAffected: 5,
                };

                await manager.addEntry('DELETE FROM users WHERE active = 0', result);

                const entries = await manager.load();

                expect(entries[0].rowCount).toBe(5);

            });

        });

        describe('saveResults and loadResults', () => {

            it('should round-trip results with gzip compression', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id', 'name', 'email'],
                    rows: [
                        { id: 1, name: 'Alice', email: 'alice@example.com' },
                        { id: 2, name: 'Bob', email: 'bob@example.com' },
                    ],
                };

                const id = 'test-id-123';
                await manager.saveResults(id, result);

                const loaded = await manager.loadResults(id);

                expect(loaded).not.toBeNull();
                expect(loaded!.success).toBe(true);
                expect(loaded!.columns).toEqual(['id', 'name', 'email']);
                expect(loaded!.rows).toHaveLength(2);
                expect(loaded!.rows![0]).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });

            });

            it('should return null when results file does not exist', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const loaded = await manager.loadResults('non-existent-id');

                expect(loaded).toBeNull();

            });

            it('should verify gzip compression actually works', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['data'],
                    rows: Array(100).fill(null).map((_, i) => ({
                        data: `This is a long string that should compress well ${i}`,
                    })),
                };

                const id = 'compression-test';
                await manager.saveResults(id, result);

                const resultsPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config', `${id}.results.gz`);
                const compressed = await readFile(resultsPath);
                const uncompressed = JSON.stringify({
                    columns: result.columns,
                    rows: result.rows,
                });

                expect(compressed.length).toBeLessThan(uncompressed.length);

            });

            it('should handle complex nested data structures', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id', 'metadata'],
                    rows: [
                        {
                            id: 1,
                            metadata: {
                                tags: ['foo', 'bar'],
                                nested: { value: 42 },
                            },
                        },
                    ],
                };

                const id = 'nested-test';
                await manager.saveResults(id, result);

                const loaded = await manager.loadResults(id);

                expect(loaded!.rows![0]).toEqual({
                    id: 1,
                    metadata: {
                        tags: ['foo', 'bar'],
                        nested: { value: 42 },
                    },
                });

            });

            it('should set durationMs to 0 in loaded results', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 999,
                    columns: ['id'],
                    rows: [{ id: 1 }],
                };

                const id = 'duration-test';
                await manager.saveResults(id, result);

                const loaded = await manager.loadResults(id);

                expect(loaded!.durationMs).toBe(0);

            });

        });

        describe('getRecent', () => {

            it('should return limited entries', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                for (let i = 0; i < 10; i++) {

                    const result: SqlExecutionResult = {
                        success: true,
                        durationMs: 100,
                        rowsAffected: 1,
                    };

                    await manager.addEntry(`SELECT ${i}`, result);

                }

                const recent = await manager.getRecent(5);

                expect(recent).toHaveLength(5);

            });

            it('should default to 50 entries', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                for (let i = 0; i < 60; i++) {

                    const result: SqlExecutionResult = {
                        success: true,
                        durationMs: 100,
                        rowsAffected: 1,
                    };

                    await manager.addEntry(`SELECT ${i}`, result);

                }

                const recent = await manager.getRecent();

                expect(recent).toHaveLength(50);

            });

            it('should return newest entries first', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result1: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                const result2: SqlExecutionResult = {
                    success: true,
                    durationMs: 200,
                    rowsAffected: 2,
                };

                await manager.addEntry('FIRST QUERY', result1);
                await manager.addEntry('SECOND QUERY', result2);

                const recent = await manager.getRecent(2);

                expect(recent[0].query).toBe('SECOND QUERY');
                expect(recent[1].query).toBe('FIRST QUERY');

            });

            it('should return all entries when limit exceeds count', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);

                const recent = await manager.getRecent(100);

                expect(recent).toHaveLength(1);

            });

        });

        describe('clearOlderThan', () => {

            it('should keep entries newer than cutoff', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);

                const clearResult = await manager.clearOlderThan(1);

                expect(clearResult.entriesRemoved).toBe(0);

                const entries = await manager.load();

                expect(entries).toHaveLength(1);

            });

            it('should remove entries older than cutoff', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                const oldDate = new Date();
                oldDate.setMonth(oldDate.getMonth() - 6);

                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'old-entry',
                            query: 'SELECT 1',
                            executedAt: oldDate.toISOString(),
                            durationMs: 100,
                            success: true,
                        },
                        {
                            id: 'new-entry',
                            query: 'SELECT 2',
                            executedAt: new Date().toISOString(),
                            durationMs: 200,
                            success: true,
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const clearResult = await manager.clearOlderThan(3);

                expect(clearResult.entriesRemoved).toBe(1);

                const entries = await manager.load();

                expect(entries).toHaveLength(1);
                expect(entries[0].id).toBe('new-entry');

            });

            it('should delete result files for removed entries', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');
                const resultsDir = join(TMP_DIR, '.noorm', 'sql-history', 'test-config');

                const oldDate = new Date();
                oldDate.setMonth(oldDate.getMonth() - 6);

                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'old-entry',
                            query: 'SELECT 1',
                            executedAt: oldDate.toISOString(),
                            durationMs: 100,
                            success: true,
                            resultsFile: 'old-entry.results.gz',
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(resultsDir, { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const dummyResults = await gzipAsync(JSON.stringify({ columns: [], rows: [] }));
                await writeFile(join(resultsDir, 'old-entry.results.gz'), dummyResults);

                const clearResult = await manager.clearOlderThan(3);

                expect(clearResult.entriesRemoved).toBe(1);
                expect(clearResult.filesRemoved).toBe(1);

                const files = await readdir(resultsDir);

                expect(files).not.toContain('old-entry.results.gz');

            });

            it('should handle entries without result files', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                const oldDate = new Date();
                oldDate.setMonth(oldDate.getMonth() - 6);

                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'old-entry',
                            query: 'SELECT 1',
                            executedAt: oldDate.toISOString(),
                            durationMs: 100,
                            success: true,
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const clearResult = await manager.clearOlderThan(3);

                expect(clearResult.entriesRemoved).toBe(1);
                expect(clearResult.filesRemoved).toBe(0);

            });

            it('should handle missing result files gracefully', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');
                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');

                const oldDate = new Date();
                oldDate.setMonth(oldDate.getMonth() - 6);

                const serialized = {
                    version: '1.0.0',
                    entries: [
                        {
                            id: 'old-entry',
                            query: 'SELECT 1',
                            executedAt: oldDate.toISOString(),
                            durationMs: 100,
                            success: true,
                            resultsFile: 'missing.results.gz',
                        },
                    ] as SqlHistoryEntrySerialized[],
                };

                await mkdir(join(TMP_DIR, '.noorm', 'sql-history'), { recursive: true });
                await writeFile(historyPath, JSON.stringify(serialized), 'utf-8');

                const clearResult = await manager.clearOlderThan(3);

                expect(clearResult.entriesRemoved).toBe(1);
                expect(clearResult.filesRemoved).toBe(0);

            });

        });

        describe('clearAll', () => {

            it('should remove all entries', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);
                await manager.addEntry('SELECT 2', result);

                const clearResult = await manager.clearAll();

                expect(clearResult.entriesRemoved).toBe(2);

                const entries = await manager.load();

                expect(entries).toHaveLength(0);

            });

            it('should remove all result files', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id'],
                    rows: [{ id: 1 }],
                };

                await manager.addEntry('SELECT 1', result);
                await manager.addEntry('SELECT 2', result);

                const clearResult = await manager.clearAll();

                expect(clearResult.entriesRemoved).toBe(2);
                expect(clearResult.filesRemoved).toBe(2);

                const resultsDir = join(TMP_DIR, '.noorm', 'sql-history', 'test-config');
                const files = await readdir(resultsDir);
                const resultFiles = files.filter(f => f.endsWith('.results.gz'));

                expect(resultFiles).toHaveLength(0);

            });

            it('should handle empty history', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const clearResult = await manager.clearAll();

                expect(clearResult.entriesRemoved).toBe(0);
                expect(clearResult.filesRemoved).toBe(0);

            });

            it('should handle missing results directory', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);

                const resultsDir = join(TMP_DIR, '.noorm', 'sql-history', 'test-config');
                await rm(resultsDir, { recursive: true, force: true });

                const clearResult = await manager.clearAll();

                expect(clearResult.entriesRemoved).toBe(1);
                expect(clearResult.filesRemoved).toBe(0);

            });

        });

        describe('getStats', () => {

            it('should return entry count and total size', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id'],
                    rows: [{ id: 1 }],
                };

                await manager.addEntry('SELECT 1', result);

                const stats = await manager.getStats();

                expect(stats.entryCount).toBe(1);
                expect(stats.resultsSize).toBeGreaterThan(0);

            });

            it('should return 0 for empty history', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const stats = await manager.getStats();

                expect(stats.entryCount).toBe(0);
                expect(stats.resultsSize).toBe(0);

            });

            it('should sum size of all result files', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result1: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id'],
                    rows: [{ id: 1 }],
                };

                const result2: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id', 'name'],
                    rows: [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Bob' },
                    ],
                };

                await manager.addEntry('SELECT 1', result1);
                await manager.addEntry('SELECT 2', result2);

                const stats = await manager.getStats();

                expect(stats.entryCount).toBe(2);
                expect(stats.resultsSize).toBeGreaterThan(0);

            });

            it('should handle entries without result files', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('INSERT INTO users VALUES (1)', result);

                const stats = await manager.getStats();

                expect(stats.entryCount).toBe(1);
                expect(stats.resultsSize).toBe(0);

            });

            it('should handle missing results directory', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);

                const resultsDir = join(TMP_DIR, '.noorm', 'sql-history', 'test-config');
                await rm(resultsDir, { recursive: true, force: true });

                const stats = await manager.getStats();

                expect(stats.entryCount).toBe(1);
                expect(stats.resultsSize).toBe(0);

            });

            it('should ignore non-result files in directory', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    columns: ['id'],
                    rows: [{ id: 1 }],
                };

                await manager.addEntry('SELECT 1', result);

                const resultsDir = join(TMP_DIR, '.noorm', 'sql-history', 'test-config');
                await writeFile(join(resultsDir, 'other-file.txt'), 'random content');

                const stats = await manager.getStats();

                expect(stats.entryCount).toBe(1);
                expect(stats.resultsSize).toBeGreaterThan(0);

            });

        });

        describe('edge cases', () => {

            it('should handle missing directory creation', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                const id = await manager.addEntry('SELECT 1', result);

                expect(id).toBeTruthy();

                const entries = await manager.load();

                expect(entries).toHaveLength(1);

            });

            it('should handle sequential writes', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);
                await manager.addEntry('SELECT 2', result);
                await manager.addEntry('SELECT 3', result);

                const entries = await manager.load();

                expect(entries).toHaveLength(3);
                expect(entries[0].query).toBe('SELECT 3');
                expect(entries[1].query).toBe('SELECT 2');
                expect(entries[2].query).toBe('SELECT 1');

            });

            it('should preserve history file formatting', async () => {

                const manager = new SqlHistoryManager(TMP_DIR, 'test-config');

                const result: SqlExecutionResult = {
                    success: true,
                    durationMs: 100,
                    rowsAffected: 1,
                };

                await manager.addEntry('SELECT 1', result);

                const historyPath = join(TMP_DIR, '.noorm', 'sql-history', 'test-config.json');
                const content = await readFile(historyPath, 'utf-8');

                const parsed = JSON.parse(content);

                expect(parsed.version).toBe('1.0.0');
                expect(parsed.entries).toHaveLength(1);

            });

        });

    });

});
