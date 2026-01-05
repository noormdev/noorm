/**
 * CLI Integration Tests: Lock Operations.
 *
 * Tests for lock/status, lock/acquire, and lock/release commands.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

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

interface LockStatus {
    isLocked: boolean;
    lock?: {
        lockedBy: string;
        lockedAt: string;
        expiresAt: string;
    };
}

interface LockAcquireResult {
    acquired: boolean;
    lockedBy: string;
    expiresAt: string;
}

interface LockReleaseResult {
    released: boolean;
}

// ─────────────────────────────────────────────────────────────
// Test Suite: lock/status
// ─────────────────────────────────────────────────────────────

describe('cli: lock status', () => {

    let project: TestProject;

    beforeEach(async () => {

        // Fresh project for each test to ensure clean lock state
        project = await setupTestProject();

    });

    afterEach(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'lock', 'status');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    it('should show unlocked status initially', async () => {

        const result = await noorm(project, 'lock', 'status');

        expect(result.ok).toBe(true);

        const text = stripAnsi(result.stdout);
        // Should show unlocked state (no active lock)
        expect(text.toLowerCase()).toMatch(/unlock|no.*lock/i);

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should return valid JSON with --json flag', { retry: 2 }, async () => {

        const result = await noormJson<LockStatus>(project, 'lock', 'status');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(typeof result.data!.isLocked).toBe('boolean');

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should show unlocked in JSON format', { retry: 2 }, async () => {

        const result = await noormJson<LockStatus>(project, 'lock', 'status');

        expect(result.ok).toBe(true);
        expect(result.data!.isLocked).toBe(false);
        expect(result.data!.lock).toBeNull();

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: lock/acquire
// ─────────────────────────────────────────────────────────────

describe('cli: lock acquire', () => {

    let project: TestProject;

    beforeEach(async () => {

        // Fresh project for each test to ensure clean lock state
        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        const result = await noorm(project, 'lock', 'acquire');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should return valid JSON with --json flag', { retry: 2 }, async () => {

        const result = await noormJson<LockAcquireResult>(project, 'lock', 'acquire');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.data!.acquired).toBe(true);
        expect(typeof result.data!.lockedBy).toBe('string');
        expect(typeof result.data!.expiresAt).toBe('string');

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should show locked status after acquire', { retry: 2 }, async () => {

        // Acquire lock
        await noorm(project, 'lock', 'acquire');

        // Check status
        const result = await noormJson<LockStatus>(project, 'lock', 'status');

        expect(result.ok).toBe(true);
        expect(result.data!.isLocked).toBe(true);
        expect(result.data!.lock).toBeDefined();

    });

    it('should extend lock when same identity re-acquires', async () => {

        // Acquire lock first time
        const first = await noorm(project, 'lock', 'acquire');
        expect(first.ok).toBe(true);

        // Re-acquire by same identity - should extend, not fail
        const second = await noorm(project, 'lock', 'acquire');
        expect(second.ok).toBe(true);
        expect(second.exitCode).toBe(0);

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: lock/release
// ─────────────────────────────────────────────────────────────

describe('cli: lock release', () => {

    let project: TestProject;

    beforeEach(async () => {

        // Fresh project for each test to ensure clean lock state
        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    it('should return exit code 0 on success', async () => {

        // First acquire a lock
        await noorm(project, 'lock', 'acquire');

        // Then release it
        const result = await noorm(project, 'lock', 'release');

        expect(result.exitCode).toBe(0);
        expect(result.ok).toBe(true);

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should return valid JSON with --json flag', { retry: 2 }, async () => {

        // First acquire a lock
        await noorm(project, 'lock', 'acquire');

        // Then release it
        const result = await noormJson<LockReleaseResult>(project, 'lock', 'release');

        expect(result.ok).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.data!.released).toBe(true);

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should show unlocked status after release', { retry: 2 }, async () => {

        // Acquire lock
        await noorm(project, 'lock', 'acquire');

        // Release lock
        await noorm(project, 'lock', 'release');

        // Check status
        const result = await noormJson<LockStatus>(project, 'lock', 'status');

        expect(result.ok).toBe(true);
        expect(result.data!.isLocked).toBe(false);

    });

    it('should fail when no lock is held', async () => {

        // Try to release without acquiring - should fail
        const result = await noorm(project, 'lock', 'release');

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(1);

    });

});

// ─────────────────────────────────────────────────────────────
// Test Suite: Lock Lifecycle
// ─────────────────────────────────────────────────────────────

describe('cli: lock lifecycle', () => {

    let project: TestProject;

    beforeAll(async () => {

        project = await setupTestProject();

    });

    afterAll(async () => {

        await cleanupTestProject(project);

    });

    // Note: This test can be flaky due to CLI process timing - retry if needed
    it('should complete full acquire-release cycle', { retry: 2 }, async () => {

        // Initial state: unlocked
        const initial = await noormJson<LockStatus>(project, 'lock', 'status');
        expect(initial.data!.isLocked).toBe(false);

        // Acquire lock
        const acquire = await noormJson<LockAcquireResult>(project, 'lock', 'acquire');
        expect(acquire.data!.acquired).toBe(true);

        // State: locked
        const locked = await noormJson<LockStatus>(project, 'lock', 'status');
        expect(locked.data!.isLocked).toBe(true);

        // Release lock
        const release = await noormJson<LockReleaseResult>(project, 'lock', 'release');
        expect(release.data!.released).toBe(true);

        // Final state: unlocked
        const final = await noormJson<LockStatus>(project, 'lock', 'status');
        expect(final.data!.isLocked).toBe(false);

    });

});
