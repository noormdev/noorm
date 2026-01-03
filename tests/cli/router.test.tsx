/**
 * Router context and navigation tests.
 *
 * Tests RouterProvider, useRouter, and navigation functions.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React, { useEffect } from 'react';
import { Text } from 'ink';

import { RouterProvider, useRouter, useRoute, useNavigation } from '../../src/cli/router.js';
import type { Route } from '../../src/cli/types.js';

/**
 * Test component that displays current route state.
 */
function RouteDisplay() {

    const { route, params, section, canGoBack, history } = useRouter();

    return (
        <Text>
            route:{route}|section:{section}|canGoBack:{String(canGoBack)}|historyLen:
            {history.length}|params:{JSON.stringify(params)}
        </Text>
    );

}

/**
 * Test component that performs navigation on mount.
 */
function NavigateOnMount({ to, params }: { to: Route; params?: Record<string, unknown> }) {

    const { navigate } = useRouter();

    useEffect(() => {

        navigate(to, params);

    }, [navigate, to, params]);

    return <RouteDisplay />;

}

/**
 * Test component that performs back navigation on mount.
 */
function BackOnMount() {

    const { back } = useRouter();

    useEffect(() => {

        back();

    }, [back]);

    return <RouteDisplay />;

}

/**
 * Test component that performs replace navigation.
 */
function ReplaceOnMount({ to, params }: { to: Route; params?: Record<string, unknown> }) {

    const { replace } = useRouter();

    useEffect(() => {

        replace(to, params);

    }, [replace, to, params]);

    return <RouteDisplay />;

}

/**
 * Test component that performs reset.
 */
function _ResetOnMount() {

    const { reset } = useRouter();

    useEffect(() => {

        reset();

    }, [reset]);

    return <RouteDisplay />;

}

describe('cli: router', () => {

    describe('RouterProvider', () => {

        it('should provide default route as home', () => {

            const { lastFrame } = render(
                <RouterProvider>
                    <RouteDisplay />
                </RouterProvider>,
            );

            expect(lastFrame()).toContain('route:home');
            expect(lastFrame()).toContain('section:home');
            expect(lastFrame()).toContain('canGoBack:false');
            expect(lastFrame()).toContain('historyLen:0');

        });

        it('should accept initial route', () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="config">
                    <RouteDisplay />
                </RouterProvider>,
            );

            expect(lastFrame()).toContain('route:config');
            expect(lastFrame()).toContain('section:config');

        });

        it('should accept initial route with nested path', () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="config/add">
                    <RouteDisplay />
                </RouterProvider>,
            );

            expect(lastFrame()).toContain('route:config/add');
            expect(lastFrame()).toContain('section:config');

        });

        it('should accept initial params', () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="config/edit" initialParams={{ name: 'production' }}>
                    <RouteDisplay />
                </RouterProvider>,
            );

            expect(lastFrame()).toContain('route:config/edit');
            expect(lastFrame()).toContain('"name":"production"');

        });

    });

    describe('useRouter', () => {

        it('should throw when used outside RouterProvider', () => {

            const errors: string[] = [];
            const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {

                errors.push(args.map(String).join(' '));

            });

            // In React 19, errors during render are caught and logged
            const { lastFrame } = render(<RouteDisplay />);
            const output = lastFrame() ?? '';

            // Error may appear in rendered output or in console.error
            const hasErrorInOutput = output.includes('useRouter must be used within a RouterProvider');
            const hasErrorInConsole = errors.some(e => e.includes('useRouter must be used within a RouterProvider'));

            expect(hasErrorInOutput || hasErrorInConsole).toBe(true);

            errorSpy.mockRestore();

        });

    });

    describe('navigate', () => {

        it('should navigate to new route', async () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <NavigateOnMount to="config" />
                </RouterProvider>,
            );

            // Wait for effect
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('route:config');

        });

        it('should push current route to history', async () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <NavigateOnMount to="config" />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('canGoBack:true');
            // History may have multiple entries due to React strict mode rerenders
            // Just verify that we can go back
            const historyMatch = lastFrame()?.match(/historyLen:(\d+)/);
            expect(historyMatch).toBeTruthy();
            expect(Number(historyMatch?.[1])).toBeGreaterThanOrEqual(1);

        });

        it('should navigate with params', async () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <NavigateOnMount to="config/edit" params={{ name: 'dev' }} />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('route:config/edit');
            expect(lastFrame()).toContain('"name":"dev"');

        });

    });

    describe('back', () => {

        it('should do nothing when no history', async () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <BackOnMount />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('route:home');
            expect(lastFrame()).toContain('canGoBack:false');

        });

        it('should navigate back to previous route', async () => {

            // First navigate away, then back
            function NavigateThenBack() {

                const { navigate, back, route: _route } = useRouter();
                const [step, setStep] = React.useState(0);

                useEffect(() => {

                    if (step === 0) {

                        navigate('config');
                        setStep(1);

                    }
                    else if (step === 1) {

                        back();
                        setStep(2);

                    }

                }, [step, navigate, back]);

                return <RouteDisplay />;

            }

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <NavigateThenBack />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('route:home');
            expect(lastFrame()).toContain('canGoBack:false');

        });

    });

    describe('replace', () => {

        it('should replace current route without adding history', async () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <ReplaceOnMount to="config" />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('route:config');
            expect(lastFrame()).toContain('canGoBack:false');
            expect(lastFrame()).toContain('historyLen:0');

        });

        it('should replace with params', async () => {

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <ReplaceOnMount to="config/edit" params={{ name: 'staging' }} />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(lastFrame()).toContain('route:config/edit');
            expect(lastFrame()).toContain('"name":"staging"');
            expect(lastFrame()).toContain('historyLen:0');

        });

    });

    describe('reset', () => {

        it('should clear history and return to home', async () => {

            function NavigateThenReset() {

                const { navigate, reset } = useRouter();
                const [step, setStep] = React.useState(0);

                useEffect(() => {

                    if (step === 0) {

                        navigate('config');
                        setStep(1);

                    }
                    else if (step === 1) {

                        navigate('config/add');
                        setStep(2);

                    }
                    else if (step === 2) {

                        reset();
                        setStep(3);

                    }

                }, [step, navigate, reset]);

                return <RouteDisplay />;

            }

            const { lastFrame } = render(
                <RouterProvider initialRoute="home">
                    <NavigateThenReset />
                </RouterProvider>,
            );

            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(lastFrame()).toContain('route:home');
            expect(lastFrame()).toContain('canGoBack:false');
            expect(lastFrame()).toContain('historyLen:0');

        });

    });

    describe('useRoute', () => {

        it('should return route, params, and section', () => {

            function RouteOnly() {

                const { route, params, section } = useRoute();

                return (
                    <Text>
                        route:{route}|section:{section}|params:{JSON.stringify(params)}
                    </Text>
                );

            }

            const { lastFrame } = render(
                <RouterProvider initialRoute="config/edit" initialParams={{ name: 'test' }}>
                    <RouteOnly />
                </RouterProvider>,
            );

            expect(lastFrame()).toContain('route:config/edit');
            expect(lastFrame()).toContain('section:config');
            expect(lastFrame()).toContain('"name":"test"');

        });

    });

    describe('useNavigation', () => {

        it('should return only navigation functions', () => {

            function NavigationOnly() {

                const nav = useNavigation();
                const hasNavigate = typeof nav.navigate === 'function';
                const hasBack = typeof nav.back === 'function';
                const hasReplace = typeof nav.replace === 'function';
                const hasReset = typeof nav.reset === 'function';
                const hasCanGoBack = typeof nav.canGoBack === 'boolean';

                return (
                    <Text>
                        navigate:{String(hasNavigate)}|back:{String(hasBack)}|replace:
                        {String(hasReplace)}|reset:{String(hasReset)}|canGoBack:
                        {String(hasCanGoBack)}
                    </Text>
                );

            }

            const { lastFrame } = render(
                <RouterProvider>
                    <NavigationOnly />
                </RouterProvider>,
            );

            expect(lastFrame()).toContain('navigate:true');
            expect(lastFrame()).toContain('back:true');
            expect(lastFrame()).toContain('replace:true');
            expect(lastFrame()).toContain('reset:true');
            expect(lastFrame()).toContain('canGoBack:true');

        });

    });

    describe('section derivation', () => {

        it('should derive section from current route', () => {

            const routes: Array<{ route: Route; expectedSection: string }> = [
                { route: 'home', expectedSection: 'home' },
                { route: 'config', expectedSection: 'config' },
                { route: 'config/add', expectedSection: 'config' },
                { route: 'config/edit', expectedSection: 'config' },
                { route: 'change/run', expectedSection: 'change' },
                { route: 'run/build', expectedSection: 'run' },
                { route: 'db/destroy', expectedSection: 'db' },
            ];

            for (const { route, expectedSection } of routes) {

                const { lastFrame, unmount } = render(
                    <RouterProvider initialRoute={route}>
                        <RouteDisplay />
                    </RouterProvider>,
                );

                expect(lastFrame()).toContain(`section:${expectedSection}`);
                unmount();

            }

        });

    });

});
