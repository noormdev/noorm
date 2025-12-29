import React, { useCallback, useEffect, useMemo } from 'react';

import {
    type NoormEvents,
    type NoormEventNames,
    type NoormEventCallback,
    observer as obsrv,
} from '../core/observer.js';

// re-export for convenience
export const observer = obsrv;

/**
 * Attaches a listener to the observer with an automatic cleanup function
 *
 * @param event App event
 * @param cb Callback to listen to
 * @param deps Dependencies to bind to
 */
export const useOnNoormEvent = <E extends NoormEventNames>(
    event: E,
    cb: NoormEventCallback<E>,
    deps: React.DependencyList = [],
) => {

    useEffect(() => obsrv.on(event, cb), [event, cb, ...deps]);

};

/**
 * Creates an event generator for an event
 *
 * @param event App event
 * @param deps Dependencies to bind to
 * @returns
 */
export const useNoormEventGenerator = <E extends NoormEventNames>(
    event: E,
    deps: React.DependencyList = [],
) => {

    return useMemo(() => obsrv.on(event), [event, ...deps]);

};

/**
 * Attaches a listener to the observer once with an automatic cleanup function
 *
 * @param event App event
 * @param cb Callback to listen to
 * @param deps Dependencies to bind to
 */
export const useOnceNoormEvent = <E extends NoormEventNames>(
    event: E,
    cb: NoormEventCallback<E>,
    deps: React.DependencyList = [],
) => {

    useEffect(() => obsrv.once(event, cb), [event, cb, ...deps]);

};

/**
 * Creates a function that emits events, scoped to a single function
 *
 * @param event App event
 * @param deps Dependencies to bind to
 */
export const useEmitNoormEvent = <E extends NoormEventNames, D extends NoormEvents[E]>(
    event: E,
    deps: React.DependencyList = [],
) => {

    return useCallback((data: D) => obsrv.emit(event, data as never), [event, ...deps]);

};
