/**
 * Connection module exports.
 *
 * Provides database connection creation and management.
 */
export { createConnection, testConnection, discardConnection } from './factory.js';
export type { ConnectionRetryOptions } from './factory.js';
export { getConnectionManager, resetConnectionManager } from './manager.js';
export { DEFAULT_PORTS, PortSchema, DEFAULT_CONNECT_TIMEOUT_MS, connectTimeoutFor } from './defaults.js';
export * from './types.js';
