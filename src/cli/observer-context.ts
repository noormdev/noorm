/**
 * Observer React context for the noorm CLI.
 *
 * Wraps the global observer instance with @logosdx/react's
 * createObserverContext for automatic lifecycle management.
 *
 * @example
 * ```typescript
 * import { useNoormObserver } from './observer-context.js';
 *
 * const { on, emit } = useNoormObserver();
 * on('change:complete', useCallback((data) => setResult(data), []));
 * ```
 */
import { createObserverContext } from '@logosdx/react';
import type { ProviderProps, UseObserverReturn } from '@logosdx/react';
import type { ReactElement } from 'react';

import { observer, type NoormEvents } from '../core/observer.js';

export const [NoormObserver, useNoormObserver]: [
    (props: ProviderProps) => ReactElement,
    () => UseObserverReturn<NoormEvents>,
] = createObserverContext(observer);
