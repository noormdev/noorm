/**
 * CLI Integration Tests: Help Command.
 *
 * Tests for the help command output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
    noorm,
    noormJson,
    setupTestProject,
    cleanupTestProject,
    stripAnsi,
    type TestProject,
} from './setup.js';

// ─────────────────────────────────────────────────────────────
// Types for JSON Output
// ─────────────────────────────────────────────────────────────

interface HelpTopics {
    topics: string[];
}

interface HelpContent {
    topic: string;
    content: string;
}

// ─────────────────────────────────────────────────────────────
// Test Suite: help (list topics)
// ─────────────────────────────────────────────────────────────

describe('cli: help', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'help');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should list available help topics', async () => {

        const result = await noorm(project, 'help');

        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text).toContain('help');

    });

    it('should return valid JSON with --json flag', async () => {

        const result = await noormJson<HelpTopics>(project, 'help');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(Array.isArray(result.data!.topics)).toBe(true);
        expect(result.data!.topics.length).toBeGreaterThan(0);

    });

    it('should include common topics in the list', async () => {

        const result = await noormJson<HelpTopics>(project, 'help');

        expect(result.ok).toBe(true);

        const topics = result.data!.topics;
        expect(topics).toContain('db');
        expect(topics).toContain('config');
        expect(topics).toContain('run');

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: help <topic>
// ─────────────────────────────────────────────────────────────

describe('cli: help <topic>', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should show help for db', async () => {

        const result = await noorm(project, 'help', 'db');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text.toLowerCase()).toContain('database');

    });

    it('should show help for config', async () => {

        const result = await noorm(project, 'help', 'config');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text.toLowerCase()).toContain('config');

    });

    it('should show help for db explore', async () => {

        const result = await noorm(project, 'help', 'db', 'explore');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text.toLowerCase()).toContain('explore');

    });

    it('should return valid JSON with --json flag', async () => {

        const result = await noormJson<HelpContent>(project, 'help', 'db');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(typeof result.data!.topic).toBe('string');
        expect(typeof result.data!.content).toBe('string');

    });

    it('should fail with exit code 1 for unknown topic', async () => {

        const result = await noorm(project, 'help', 'nonexistent');

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(1);

    });

    it('should support nested topics like db explore tables', async () => {

        const result = await noorm(project, 'help', 'db', 'explore', 'tables');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        expect(text.toLowerCase()).toContain('table');

    });

});
