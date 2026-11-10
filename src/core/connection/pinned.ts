/**
 * Pinned connections a caller may close instead of returning to the pool.
 *
 * Kysely never says which driver connection it pinned and always releases it,
 * so each pooled dialect reports its checkouts and asks about its releases here.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Kysely } from 'kysely';

import type { ConnectionResult, PinnedConnection } from './types.js';

/**
 * Track which driver connection each `withConnection` call is pinned to.
 *
 * One tracker per pool. The link rides on the call's async context, so
 * concurrent calls, and other pools used inside a callback, stay apart.
 * Resources are `unknown` because Kysely does not export its MSSQL connection type.
 *
 * @example
 * const pins = trackPinnedConnections();
 * const pinTo = pins.claim();           // synchronously, where the pool is asked
 * pinTo(client);                        // once the pool answers
 * if (pins.isDiscarded(client)) { ... } // where Kysely releases it
 */
export function trackPinnedConnections() {

    const calls = new AsyncLocalStorage<{ resource?: object }>();
    const discarded = new WeakSet<object>();
    const isObject = (resource: unknown): resource is object => typeof resource === 'object' && resource !== null;

    return {
        claim() {

            const call = calls.getStore();

            return (resource: unknown): void => {

                // Kysely pins before it runs the callback, so the first checkout
                // is the pinned one; later ones are the callback's own pool queries.
                if (call && !call.resource && isObject(resource)) call.resource = resource;

            };

        },

        isDiscarded: (resource: unknown): boolean => isObject(resource) && discarded.has(resource),

        withConnection(db: Kysely<unknown>): NonNullable<ConnectionResult['withConnection']> {

            return (fn) => {

                const call: { resource?: object } = {};
                let discard = false;
                const handle: PinnedConnection = {
                    discard: () => {

                        discard = true;

                    },
                };

                return calls.run(call, () => db.connection().execute(async (pinned) => {

                    try {

                        return await fn(pinned, handle);

                    }
                    finally {

                        // Marked only now, so a handle kept past its callback
                        // cannot close a connection someone else checked out.
                        if (discard && call.resource) discarded.add(call.resource);

                    }

                }));

            };

        },
    };

}
