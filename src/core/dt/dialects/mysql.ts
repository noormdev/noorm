/**
 * MySQL type mappings for the .dt universal type system.
 *
 * Version-aware: MySQL 9.0+ introduced native VECTOR(N).
 * Earlier versions use JSON as a workaround for vectors.
 *
 * @example
 * ```typescript
 * import { MYSQL_TO_UNIVERSAL, getUniversalToMysql } from './mysql.js';
 * ```
 */
import type { TypePattern } from './postgres.js';
import type { UniversalType, DatabaseVersion } from '../types.js';

/**
 * MySQL source type → universal type mappings.
 *
 * Tested in order; first match wins. More specific patterns must come first.
 */
export const MYSQL_TO_UNIVERSAL: TypePattern[] = [
    // Boolean (must come before generic TINYINT)
    { pattern: /^tinyint\(1\)$/i, universalType: 'bool', native: true },
    { pattern: /^boolean$/i, universalType: 'bool', native: true },
    { pattern: /^bool$/i, universalType: 'bool', native: true },

    // Integer types
    { pattern: /^tinyint/i, universalType: 'int', native: true },
    { pattern: /^smallint/i, universalType: 'int', native: true },
    { pattern: /^mediumint/i, universalType: 'int', native: true },
    { pattern: /^int\b/i, universalType: 'int', native: true },
    { pattern: /^integer/i, universalType: 'int', native: true },
    { pattern: /^year$/i, universalType: 'int', native: true },

    // Bigint
    { pattern: /^bigint/i, universalType: 'bigint', native: true },

    // Float
    { pattern: /^float/i, universalType: 'float', native: true },
    { pattern: /^double/i, universalType: 'float', native: true },

    // Decimal
    { pattern: /^decimal/i, universalType: 'decimal', native: true },
    { pattern: /^numeric/i, universalType: 'decimal', native: true },

    // Date/time
    { pattern: /^datetime/i, universalType: 'timestamp', native: true },
    { pattern: /^timestamp/i, universalType: 'timestamp', native: true },
    { pattern: /^date$/i, universalType: 'date', native: true },
    { pattern: /^time/i, universalType: 'string', native: true },

    // JSON
    { pattern: /^json$/i, universalType: 'json', native: true },

    // Vector (MySQL 9.0+)
    { pattern: /^vector/i, universalType: 'vector', native: true },

    // Binary types
    { pattern: /^bit/i, universalType: 'binary', native: true },
    { pattern: /^binary/i, universalType: 'binary', native: true },
    { pattern: /^varbinary/i, universalType: 'binary', native: true },
    { pattern: /^tinyblob$/i, universalType: 'binary', native: true },
    { pattern: /^blob$/i, universalType: 'binary', native: true },
    { pattern: /^mediumblob$/i, universalType: 'binary', native: true },
    { pattern: /^longblob$/i, universalType: 'binary', native: true },

    // Enum/Set → custom
    { pattern: /^enum/i, universalType: 'custom', native: true },
    { pattern: /^set/i, universalType: 'custom', native: true },

    // String types
    { pattern: /^char/i, universalType: 'string', native: true },
    { pattern: /^varchar/i, universalType: 'string', native: true },
    { pattern: /^tinytext$/i, universalType: 'string', native: true },
    { pattern: /^text$/i, universalType: 'string', native: true },
    { pattern: /^mediumtext$/i, universalType: 'string', native: true },
    { pattern: /^longtext$/i, universalType: 'string', native: true },

    // Everything else → custom
    { pattern: /.*/, universalType: 'custom', native: false },
];

/**
 * Get MySQL target type for a universal type, version-aware.
 *
 * MySQL 9.0+ supports native VECTOR(N).
 * Older versions fall back to JSON for vector/array storage.
 *
 * @param universalType - The universal type to map
 * @param version - Target MySQL version (optional)
 * @returns MySQL type string
 */
export function getUniversalToMysql(universalType: UniversalType, version?: DatabaseVersion): string {

    const major = version?.major ?? 8;

    switch (universalType) {

    case 'string':
        return 'varchar(255)';

    case 'int':
        return 'int';

    case 'bigint':
        return 'bigint';

    case 'float':
        return 'double';

    case 'decimal':
        return 'decimal(38,10)';

    case 'bool':
        return 'tinyint(1)';

    case 'timestamp':
        return 'datetime(6)';

    case 'date':
        return 'date';

    case 'uuid':
        return 'char(36)';

    case 'json':
        return 'json';

    case 'binary':
        return 'longblob';

    case 'vector':
        // MySQL 9.0+ has native VECTOR
        return major >= 9 ? 'vector(2048)' : 'json';

    case 'array':
        return 'json';

    case 'custom':
        return 'text';

    default:
        return 'text';

    }

}
