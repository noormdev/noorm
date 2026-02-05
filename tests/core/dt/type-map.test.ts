/**
 * Type mapping tests.
 *
 * Covers toUniversalType(), toDialectType(), isEncodedType() across
 * all three dialects with version-aware behavior.
 */
import { describe, it, expect } from 'vitest';
import {
    toUniversalType,
    toDialectType,
    isEncodedType,
} from '../../../src/core/dt/type-map.js';
import type { DatabaseVersion } from '../../../src/core/dt/types.js';

describe('dt: type-map', () => {

    // -----------------------------------------------------------------------
    // toUniversalType
    // -----------------------------------------------------------------------

    describe('toUniversalType', () => {

        describe('postgres', () => {

            it('should map integer types', () => {

                const cases = ['integer', 'int', 'int4', 'smallint', 'int2', 'serial', 'smallserial'];

                for (const dbType of cases) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('int');
                    expect(result.native).toBe(true);

                }

            });

            it('should map bigint types', () => {

                for (const dbType of ['bigint', 'int8', 'bigserial']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('bigint');

                }

            });

            it('should map float types', () => {

                for (const dbType of ['real', 'float4', 'double precision', 'float8']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('float');

                }

            });

            it('should map decimal types', () => {

                for (const dbType of ['numeric', 'numeric(10,2)', 'decimal', 'decimal(18,4)']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('decimal');

                }

            });

            it('should map boolean types', () => {

                for (const dbType of ['boolean', 'bool']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('bool');

                }

            });

            it('should map uuid', () => {

                const result = toUniversalType({ dbType: 'uuid', dialect: 'postgres' });
                expect(result.universalType).toBe('uuid');

            });

            it('should map timestamp types', () => {

                for (const dbType of ['timestamptz', 'timestamp', 'timestamp without time zone']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('timestamp');

                }

            });

            it('should map date', () => {

                const result = toUniversalType({ dbType: 'date', dialect: 'postgres' });
                expect(result.universalType).toBe('date');

            });

            it('should map json types', () => {

                for (const dbType of ['jsonb', 'json']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('json');

                }

            });

            it('should map binary', () => {

                const result = toUniversalType({ dbType: 'bytea', dialect: 'postgres' });
                expect(result.universalType).toBe('binary');

            });

            it('should map vector', () => {

                const result = toUniversalType({ dbType: 'vector(1536)', dialect: 'postgres' });
                expect(result.universalType).toBe('vector');

            });

            it('should map array types', () => {

                for (const dbType of ['integer[]', 'text[]', 'ARRAY']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('array');

                }

            });

            it('should map string types', () => {

                for (const dbType of ['text', 'varchar(255)', 'character varying(100)', 'char(10)', 'citext', 'name']) {

                    const result = toUniversalType({ dbType, dialect: 'postgres' });
                    expect(result.universalType).toBe('string');

                }

            });

            it('should map unknown types to custom', () => {

                const result = toUniversalType({ dbType: 'point', dialect: 'postgres' });
                expect(result.universalType).toBe('custom');
                expect(result.native).toBe(false);

            });

        });

        describe('mysql', () => {

            it('should map tinyint(1) to bool', () => {

                const result = toUniversalType({ dbType: 'tinyint(1)', dialect: 'mysql' });
                expect(result.universalType).toBe('bool');

            });

            it('should map other tinyint to int', () => {

                const result = toUniversalType({ dbType: 'tinyint(4)', dialect: 'mysql' });
                expect(result.universalType).toBe('int');

            });

            it('should map integer types', () => {

                for (const dbType of ['smallint', 'mediumint', 'int', 'integer']) {

                    const result = toUniversalType({ dbType, dialect: 'mysql' });
                    expect(result.universalType).toBe('int');

                }

            });

            it('should map bigint', () => {

                const result = toUniversalType({ dbType: 'bigint', dialect: 'mysql' });
                expect(result.universalType).toBe('bigint');

            });

            it('should map json', () => {

                const result = toUniversalType({ dbType: 'json', dialect: 'mysql' });
                expect(result.universalType).toBe('json');

            });

            it('should map vector', () => {

                const result = toUniversalType({ dbType: 'vector(2048)', dialect: 'mysql' });
                expect(result.universalType).toBe('vector');

            });

            it('should map binary types', () => {

                for (const dbType of ['binary(16)', 'varbinary(256)', 'blob', 'longblob']) {

                    const result = toUniversalType({ dbType, dialect: 'mysql' });
                    expect(result.universalType).toBe('binary');

                }

            });

            it('should map enum/set to custom', () => {

                for (const dbType of ['enum(\'a\',\'b\')', 'set(\'x\',\'y\')']) {

                    const result = toUniversalType({ dbType, dialect: 'mysql' });
                    expect(result.universalType).toBe('custom');

                }

            });

            it('should map string types', () => {

                for (const dbType of ['varchar(255)', 'text', 'longtext', 'char(10)']) {

                    const result = toUniversalType({ dbType, dialect: 'mysql' });
                    expect(result.universalType).toBe('string');

                }

            });

        });

        describe('mssql', () => {

            it('should map bit to bool', () => {

                const result = toUniversalType({ dbType: 'bit', dialect: 'mssql' });
                expect(result.universalType).toBe('bool');

            });

            it('should map integer types', () => {

                for (const dbType of ['tinyint', 'smallint', 'int']) {

                    const result = toUniversalType({ dbType, dialect: 'mssql' });
                    expect(result.universalType).toBe('int');

                }

            });

            it('should map bigint', () => {

                const result = toUniversalType({ dbType: 'bigint', dialect: 'mssql' });
                expect(result.universalType).toBe('bigint');

            });

            it('should map uniqueidentifier to uuid', () => {

                const result = toUniversalType({ dbType: 'uniqueidentifier', dialect: 'mssql' });
                expect(result.universalType).toBe('uuid');

            });

            it('should map datetime types', () => {

                for (const dbType of ['datetime2', 'datetimeoffset', 'datetime', 'smalldatetime']) {

                    const result = toUniversalType({ dbType, dialect: 'mssql' });
                    expect(result.universalType).toBe('timestamp');

                }

            });

            it('should map json to json', () => {

                const result = toUniversalType({ dbType: 'json', dialect: 'mssql' });
                expect(result.universalType).toBe('json');

            });

            it('should map nvarchar(max) to string', () => {

                const result = toUniversalType({ dbType: 'nvarchar(max)', dialect: 'mssql' });
                expect(result.universalType).toBe('string');

            });

            it('should map xml to custom', () => {

                const result = toUniversalType({ dbType: 'xml', dialect: 'mssql' });
                expect(result.universalType).toBe('custom');

            });

        });

    });

    // -----------------------------------------------------------------------
    // toDialectType
    // -----------------------------------------------------------------------

    describe('toDialectType', () => {

        it('should map json to jsonb for postgres', () => {

            const result = toDialectType({ universalType: 'json', dialect: 'postgres' });
            expect(result).toBe('jsonb');

        });

        it('should map json to json for mysql', () => {

            const result = toDialectType({ universalType: 'json', dialect: 'mysql' });
            expect(result).toBe('json');

        });

        it('should map json to nvarchar(max) for mssql < 2025', () => {

            const version: DatabaseVersion = { dialect: 'mssql', major: 2022, minor: 0, raw: '16.0' };
            const result = toDialectType({ universalType: 'json', dialect: 'mssql', version });
            expect(result).toBe('nvarchar(max)');

        });

        it('should map json to json for mssql 2025+', () => {

            const version: DatabaseVersion = { dialect: 'mssql', major: 2025, minor: 0, raw: '17.0' };
            const result = toDialectType({ universalType: 'json', dialect: 'mssql', version });
            expect(result).toBe('json');

        });

        it('should map vector to vector for postgres', () => {

            const result = toDialectType({ universalType: 'vector', dialect: 'postgres' });
            expect(result).toBe('vector');

        });

        it('should map vector to json for mysql < 9', () => {

            const version: DatabaseVersion = { dialect: 'mysql', major: 8, minor: 0, raw: '8.0.35' };
            const result = toDialectType({ universalType: 'vector', dialect: 'mysql', version });
            expect(result).toBe('json');

        });

        it('should map vector to vector(2048) for mysql 9+', () => {

            const version: DatabaseVersion = { dialect: 'mysql', major: 9, minor: 0, raw: '9.0.1' };
            const result = toDialectType({ universalType: 'vector', dialect: 'mysql', version });
            expect(result).toBe('vector(2048)');

        });

        it('should map vector to nvarchar(max) for mssql < 2025', () => {

            const version: DatabaseVersion = { dialect: 'mssql', major: 2022, minor: 0, raw: '16.0' };
            const result = toDialectType({ universalType: 'vector', dialect: 'mssql', version });
            expect(result).toBe('nvarchar(max)');

        });

        it('should map bool to boolean for postgres', () => {

            const result = toDialectType({ universalType: 'bool', dialect: 'postgres' });
            expect(result).toBe('boolean');

        });

        it('should map bool to tinyint(1) for mysql', () => {

            const result = toDialectType({ universalType: 'bool', dialect: 'mysql' });
            expect(result).toBe('tinyint(1)');

        });

        it('should map bool to bit for mssql', () => {

            const result = toDialectType({ universalType: 'bool', dialect: 'mssql' });
            expect(result).toBe('bit');

        });

        it('should map uuid to uuid for postgres', () => {

            const result = toDialectType({ universalType: 'uuid', dialect: 'postgres' });
            expect(result).toBe('uuid');

        });

        it('should map uuid to char(36) for mysql', () => {

            const result = toDialectType({ universalType: 'uuid', dialect: 'mysql' });
            expect(result).toBe('char(36)');

        });

        it('should map uuid to uniqueidentifier for mssql', () => {

            const result = toDialectType({ universalType: 'uuid', dialect: 'mssql' });
            expect(result).toBe('uniqueidentifier');

        });

    });

    // -----------------------------------------------------------------------
    // isEncodedType
    // -----------------------------------------------------------------------

    describe('isEncodedType', () => {

        it('should return true for encoded types', () => {

            expect(isEncodedType('json')).toBe(true);
            expect(isEncodedType('binary')).toBe(true);
            expect(isEncodedType('vector')).toBe(true);
            expect(isEncodedType('array')).toBe(true);
            expect(isEncodedType('custom')).toBe(true);

        });

        it('should return false for simple types', () => {

            expect(isEncodedType('string')).toBe(false);
            expect(isEncodedType('int')).toBe(false);
            expect(isEncodedType('bigint')).toBe(false);
            expect(isEncodedType('float')).toBe(false);
            expect(isEncodedType('decimal')).toBe(false);
            expect(isEncodedType('bool')).toBe(false);
            expect(isEncodedType('timestamp')).toBe(false);
            expect(isEncodedType('date')).toBe(false);
            expect(isEncodedType('uuid')).toBe(false);

        });

    });

});
