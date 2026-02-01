import { describe, it, expect } from 'vitest';

import {
    isTransferSupported,
    getTransferOperations,
    TRANSFER_SUPPORTED_DIALECTS,
    postgresTransferOperations,
    mysqlTransferOperations,
    mssqlTransferOperations,
} from '../../../../src/core/transfer/dialects/index.js';

describe('transfer: dialect factory', () => {

    describe('TRANSFER_SUPPORTED_DIALECTS', () => {

        it('should include postgres, mysql, and mssql', () => {

            expect(TRANSFER_SUPPORTED_DIALECTS).toContain('postgres');
            expect(TRANSFER_SUPPORTED_DIALECTS).toContain('mysql');
            expect(TRANSFER_SUPPORTED_DIALECTS).toContain('mssql');

        });

        it('should not include sqlite', () => {

            expect(TRANSFER_SUPPORTED_DIALECTS).not.toContain('sqlite');

        });

        it('should have exactly 3 supported dialects', () => {

            expect(TRANSFER_SUPPORTED_DIALECTS).toHaveLength(3);

        });

    });

    describe('isTransferSupported', () => {

        it('should return true for postgres', () => {

            expect(isTransferSupported('postgres')).toBe(true);

        });

        it('should return true for mysql', () => {

            expect(isTransferSupported('mysql')).toBe(true);

        });

        it('should return true for mssql', () => {

            expect(isTransferSupported('mssql')).toBe(true);

        });

        it('should return false for sqlite', () => {

            expect(isTransferSupported('sqlite')).toBe(false);

        });

    });

    describe('getTransferOperations', () => {

        it('should return postgres operations for postgres dialect', () => {

            const ops = getTransferOperations('postgres');

            expect(ops).toBe(postgresTransferOperations);

        });

        it('should return mysql operations for mysql dialect', () => {

            const ops = getTransferOperations('mysql');

            expect(ops).toBe(mysqlTransferOperations);

        });

        it('should return mssql operations for mssql dialect', () => {

            const ops = getTransferOperations('mssql');

            expect(ops).toBe(mssqlTransferOperations);

        });

        it('should return null for sqlite', () => {

            const ops = getTransferOperations('sqlite');

            expect(ops).toBeNull();

        });

        it('should return operations with required interface methods', () => {

            const ops = getTransferOperations('postgres');

            expect(ops).not.toBeNull();
            expect(typeof ops!.getDisableFKSql).toBe('function');
            expect(typeof ops!.getEnableFKSql).toBe('function');
            expect(typeof ops!.getEnableIdentityInsertSql).toBe('function');
            expect(typeof ops!.getDisableIdentityInsertSql).toBe('function');
            expect(typeof ops!.getResetSequenceSql).toBe('function');
            expect(typeof ops!.buildConflictInsert).toBe('function');
            expect(typeof ops!.buildDirectTransfer).toBe('function');
            expect(typeof ops!.executeDisableFK).toBe('function');
            expect(typeof ops!.executeEnableFK).toBe('function');

        });

    });

});
