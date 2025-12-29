/**
 * Status components tests.
 *
 * Tests LockStatus and ConnectionStatus components.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { LockStatus, ConnectionStatus } from '../../../src/cli/components/status/index.js';

describe('cli: components/status', () => {

    describe('LockStatus', () => {

        it('should render free status', () => {

            const { lastFrame } = render(<LockStatus status="free" />);

            expect(lastFrame()).toContain('UNLOCKED');

        });

        it('should render locked status', () => {

            const { lastFrame } = render(<LockStatus status="locked" />);

            expect(lastFrame()).toContain('LOCKED');

        });

        it('should render blocked status', () => {

            const { lastFrame } = render(<LockStatus status="blocked" />);

            expect(lastFrame()).toContain('BLOCKED');

        });

        it('should render expired status', () => {

            const { lastFrame } = render(<LockStatus status="expired" />);

            expect(lastFrame()).toContain('EXPIRED');

        });

        it('should show holder when locked', () => {

            const { lastFrame } = render(<LockStatus status="locked" holder="alice@example.com" />);

            expect(lastFrame()).toContain('alice@example.com');
            expect(lastFrame()).toContain('Holder');

        });

        it('should not show holder when free', () => {

            const { lastFrame } = render(<LockStatus status="free" holder="alice@example.com" />);

            expect(lastFrame()).not.toContain('alice@example.com');

        });

        it('should show since time', () => {

            const since = new Date(Date.now() - 5 * 60000); // 5 minutes ago

            const { lastFrame } = render(<LockStatus status="locked" since={since} />);

            expect(lastFrame()).toContain('Since');
            // Check for approximate time (4-5m due to test timing)
            expect(lastFrame()).toMatch(/(4|5)m ago/);

        });

        it('should show expires time', () => {

            const expires = new Date(Date.now() + 30 * 60000); // 30 minutes from now

            const { lastFrame } = render(<LockStatus status="locked" expires={expires} />);

            expect(lastFrame()).toContain('Expires');
            // Check for approximate time (29-30m due to test timing)
            expect(lastFrame()).toMatch(/in (29|30)m/);

        });

        it('should render compact mode', () => {

            const { lastFrame } = render(
                <LockStatus status="locked" holder="alice@example.com" compact />,
            );

            expect(lastFrame()).toContain('LOCKED');
            expect(lastFrame()).not.toContain('Holder');

        });

    });

    describe('ConnectionStatus', () => {

        it('should render disconnected status', () => {

            const { lastFrame } = render(<ConnectionStatus status="disconnected" />);

            expect(lastFrame()).toContain('DISCONNECTED');

        });

        it('should render connecting status', () => {

            const { lastFrame } = render(<ConnectionStatus status="connecting" />);

            expect(lastFrame()).toContain('CONNECTING');

        });

        it('should render connected status', () => {

            const { lastFrame } = render(<ConnectionStatus status="connected" />);

            expect(lastFrame()).toContain('CONNECTED');

        });

        it('should render error status', () => {

            const { lastFrame } = render(<ConnectionStatus status="error" />);

            expect(lastFrame()).toContain('ERROR');

        });

        it('should show config name when connected', () => {

            const { lastFrame } = render(
                <ConnectionStatus status="connected" configName="production" />,
            );

            expect(lastFrame()).toContain('production');
            expect(lastFrame()).toContain('Config');

        });

        it('should not show config name when disconnected', () => {

            const { lastFrame } = render(
                <ConnectionStatus status="disconnected" configName="production" />,
            );

            expect(lastFrame()).not.toContain('production');

        });

        it('should show dialect when connected', () => {

            const { lastFrame } = render(
                <ConnectionStatus status="connected" dialect="postgres" />,
            );

            expect(lastFrame()).toContain('postgres');
            expect(lastFrame()).toContain('Dialect');

        });

        it('should show error message', () => {

            const { lastFrame } = render(
                <ConnectionStatus status="error" error="Connection refused" />,
            );

            expect(lastFrame()).toContain('Connection refused');

        });

        it('should render compact mode with config name', () => {

            const { lastFrame } = render(
                <ConnectionStatus status="connected" configName="dev" compact />,
            );

            expect(lastFrame()).toContain('CONNECTED');
            expect(lastFrame()).toContain('(dev)');

        });

    });

});
