import { describe, it, expect } from 'vitest';

import { isSameServer, getDefaultPort } from '../../../src/core/transfer/same-server.js';
import type { ConnectionConfig } from '../../../src/core/connection/types.js';

describe('transfer: same-server', () => {

    describe('getDefaultPort', () => {

        it('should return 5432 for postgres', () => {

            expect(getDefaultPort('postgres')).toBe(5432);

        });

        it('should return 3306 for mysql', () => {

            expect(getDefaultPort('mysql')).toBe(3306);

        });

        it('should return 1433 for mssql', () => {

            expect(getDefaultPort('mssql')).toBe(1433);

        });

        it('should return 0 for sqlite', () => {

            expect(getDefaultPort('sqlite')).toBe(0);

        });

    });

    describe('isSameServer', () => {

        describe('dialect matching', () => {

            it('should return false for different dialects', () => {

                const postgres: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'localhost',
                    port: 5432,
                    database: 'db1',
                };

                const mysql: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 5432,
                    database: 'db2',
                };

                expect(isSameServer(postgres, mysql)).toBe(false);

            });

            it('should return false for sqlite (no server concept)', () => {

                const source: ConnectionConfig = {
                    dialect: 'sqlite',
                    database: '/path/to/db1.sqlite',
                };

                const dest: ConnectionConfig = {
                    dialect: 'sqlite',
                    database: '/path/to/db2.sqlite',
                };

                expect(isSameServer(source, dest)).toBe(false);

            });

        });

        describe('host normalization', () => {

            it('should treat localhost and 127.0.0.1 as same host (mysql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 3306,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: '127.0.0.1',
                    port: 3306,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should treat ::1 as localhost (mysql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 3306,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: '::1',
                    port: 3306,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should treat localhost.localdomain as localhost (mysql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 3306,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost.localdomain',
                    port: 3306,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should be case-insensitive for hostnames (mysql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'LOCALHOST',
                    port: 3306,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 3306,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should default undefined host to localhost (mysql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    port: 3306,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 3306,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should recognize different remote hosts', () => {

                const source: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'server1.example.com',
                    port: 5432,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'server2.example.com',
                    port: 5432,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(false);

            });

        });

        describe('port matching', () => {

            it('should return false for different ports', () => {

                const source: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'localhost',
                    port: 5432,
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'localhost',
                    port: 5433,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(false);

            });

            it('should use default port when not specified (postgres)', () => {

                const source: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'localhost',
                    database: 'same_db',
                };

                const dest: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'localhost',
                    port: 5432,
                    database: 'same_db',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should use default port when not specified (mysql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'localhost',
                    port: 3306,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should use default port when not specified (mssql)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mssql',
                    host: 'localhost',
                    database: 'db1',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mssql',
                    host: 'localhost',
                    port: 1433,
                    database: 'db2',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

        });

        describe('same server detection', () => {

            it('should return false for postgres with different databases', () => {

                const source: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'db.example.com',
                    port: 5432,
                    database: 'source_db',
                };

                const dest: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'db.example.com',
                    port: 5432,
                    database: 'dest_db',
                };

                // PostgreSQL cannot do cross-database queries
                expect(isSameServer(source, dest)).toBe(false);

            });

            it('should return true for postgres with same database', () => {

                const source: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'db.example.com',
                    port: 5432,
                    database: 'same_db',
                };

                const dest: ConnectionConfig = {
                    dialect: 'postgres',
                    host: 'db.example.com',
                    port: 5432,
                    database: 'same_db',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should return true for mysql with different databases (cross-db supported)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'db.example.com',
                    port: 3306,
                    database: 'source_db',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mysql',
                    host: 'db.example.com',
                    port: 3306,
                    database: 'dest_db',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

            it('should return true for mssql with different databases (cross-db supported)', () => {

                const source: ConnectionConfig = {
                    dialect: 'mssql',
                    host: 'db.example.com',
                    port: 1433,
                    database: 'source_db',
                };

                const dest: ConnectionConfig = {
                    dialect: 'mssql',
                    host: 'db.example.com',
                    port: 1433,
                    database: 'dest_db',
                };

                expect(isSameServer(source, dest)).toBe(true);

            });

        });

    });

});
