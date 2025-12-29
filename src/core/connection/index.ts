/**
 * Connection module exports.
 *
 * Provides database connection creation and management.
 */
export { createConnection, testConnection } from './factory.js';
export { getConnectionManager, resetConnectionManager } from './manager.js';
export * from './types.js';
