import type { DtColumn, DtValue } from '../dt/types.js';
import type { Dialect } from '../connection/types.js';

// Wire protocol — the shape of every postMessage payload
export interface WireMessage {
    event: string
    data: unknown
}

// Maps 'query' → 'query:res' for typed request/response
export type ResKey<K extends string> = `${K}:res`

// Correlation ID injected by request() — worker scripts destructure this
// from incoming data and use it to suffix the response event name.
// See Correlation Protocol in the spec.
export type Correlated<T> = T & { __cid: string }

// --- Connection Worker Events ---

export type ConnectionEvents = {
    'connect': { dialect: string; connectionString: string }
    'connect:res': { success: boolean; error?: string }
    'disconnect': Record<string, never>
    'disconnect:res': Record<string, never>
    'query': { sql: string; params?: unknown[] }
    'query:res': { rows: unknown[]; error?: string }
    'query:batch': { sql: string; params?: unknown[]; batchSize: number; offset: number }
    'query:batch:res': { rows: unknown[]; offset: number; hasMore: boolean; error?: string }
    'execute': { sql: string; params?: unknown[] }
    'execute:res': { affectedRows: number; error?: string }
}

// --- Compute Worker Events ---

export type ComputeEvents = {
    'serialize': { row: Record<string, unknown>; columns: DtColumn[]; index: number }
    'serialize:res': { values: DtValue[]; index: number; error?: string }
    'deserialize': { values: DtValue[]; columns: DtColumn[]; targetDialect: Dialect; targetVersion?: string; index: number }
    'deserialize:res': { record: Record<string, unknown>; index: number; error?: string }
}

// --- Pool Options ---

export interface PoolOptions {
    size: number
}
