/**
 * Connection factory tests.
 *
 * Uses SQLite in-memory databases for testing (no external DB needed).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { sql } from 'kysely'
import { createConnection, testConnection } from '../../../src/core/connection/index.js'
import type { ConnectionConfig } from '../../../src/core/connection/index.js'


describe('connection: factory', () => {

    const connections: Array<{ destroy: () => Promise<void> }> = []

    afterEach(async () => {

        // Clean up all connections
        for (const conn of connections) {

            await conn.destroy()
        }
        connections.length = 0
    })

    describe('createConnection', () => {

        it('should create a SQLite in-memory connection', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            }

            const conn = await createConnection(config)
            connections.push(conn)

            expect(conn.dialect).toBe('sqlite')
            expect(conn.db).toBeDefined()
        })

        it('should execute queries on SQLite connection', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            }

            const conn = await createConnection(config)
            connections.push(conn)

            // Create a table
            await sql`CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)`.execute(conn.db)

            // Insert data
            await sql`INSERT INTO test (id, name) VALUES (1, 'Alice')`.execute(conn.db)
            await sql`INSERT INTO test (id, name) VALUES (2, 'Bob')`.execute(conn.db)

            // Query data
            const result = await sql<{ id: number; name: string }>`SELECT * FROM test ORDER BY id`.execute(conn.db)

            expect(result.rows).toHaveLength(2)
            expect(result.rows[0].name).toBe('Alice')
            expect(result.rows[1].name).toBe('Bob')
        })

        it('should throw for unsupported dialect', async () => {

            const config = {
                dialect: 'oracle' as never,
                database: 'test',
            }

            await expect(createConnection(config)).rejects.toThrow('Unsupported dialect')
        })

        it.skip('should throw helpful error for missing driver', async () => {

            // Skip: All drivers (pg, mysql2, tedious) are installed in this project
            // This test would only apply when a driver is missing
            const config: ConnectionConfig = {
                dialect: 'mysql',
                host: 'localhost',
                database: 'test',
            }

            await expect(createConnection(config)).rejects.toThrow(/Cannot find module|Missing driver/)
        })
    })

    describe('testConnection', () => {

        it('should return ok: true for valid SQLite connection', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            }

            const result = await testConnection(config)

            expect(result.ok).toBe(true)
            expect(result.error).toBeUndefined()
        })

        it('should return ok: false for invalid connection', async () => {

            // Use SQLite with invalid path to avoid network timeouts
            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: '/nonexistent/path/that/does/not/exist/db.sqlite',
            }

            const result = await testConnection(config)

            expect(result.ok).toBe(false)
            expect(result.error).toBeDefined()
        })
    })

    describe('connection lifecycle', () => {

        it('should destroy connection cleanly', async () => {

            const config: ConnectionConfig = {
                dialect: 'sqlite',
                database: ':memory:',
            }

            const conn = await createConnection(config)

            // Destroy should not throw
            await expect(conn.destroy()).resolves.toBeUndefined()

            // Using the connection after destroy should fail
            await expect(sql`SELECT 1`.execute(conn.db)).rejects.toThrow()
        })
    })
})
