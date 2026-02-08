/**
 * MSSQL type mappings for the .dt universal type system.
 *
 * Version-aware: SQL Server 2025 introduced native JSON and VECTOR types.
 * Earlier versions use NVARCHAR(MAX) as a workaround.
 *
 * @example
 * ```typescript
 * import { MSSQL_TO_UNIVERSAL, getUniversalToMssql } from './mssql.js';
 * ```
 */
import type { TypePattern } from './postgres.js';
import type { UniversalType, DatabaseVersion } from '../types.js';

/**
 * MSSQL source type → universal type mappings.
 *
 * Tested in order; first match wins.
 */
export const MSSQL_TO_UNIVERSAL: TypePattern[] = [
    // Boolean
    { pattern: /^bit$/i, universalType: 'bool', native: true },

    // Integer types
    { pattern: /^tinyint$/i, universalType: 'int', native: true },
    { pattern: /^smallint$/i, universalType: 'int', native: true },
    { pattern: /^int$/i, universalType: 'int', native: true },

    // Bigint
    { pattern: /^bigint$/i, universalType: 'bigint', native: true },

    // Float
    { pattern: /^float/i, universalType: 'float', native: true },
    { pattern: /^real$/i, universalType: 'float', native: true },

    // Decimal
    { pattern: /^decimal/i, universalType: 'decimal', native: true },
    { pattern: /^numeric/i, universalType: 'decimal', native: true },
    { pattern: /^money$/i, universalType: 'decimal', native: true },
    { pattern: /^smallmoney$/i, universalType: 'decimal', native: true },

    // UUID
    { pattern: /^uniqueidentifier$/i, universalType: 'uuid', native: true },

    // Date/time
    { pattern: /^datetime2/i, universalType: 'timestamp', native: true },
    { pattern: /^datetimeoffset/i, universalType: 'timestamp', native: true },
    { pattern: /^datetime$/i, universalType: 'timestamp', native: true },
    { pattern: /^smalldatetime$/i, universalType: 'timestamp', native: true },
    { pattern: /^date$/i, universalType: 'date', native: true },
    { pattern: /^time/i, universalType: 'string', native: true },

    // Native JSON (SQL Server 2025+)
    { pattern: /^json$/i, universalType: 'json', native: true },

    // Native VECTOR (SQL Server 2025+)
    { pattern: /^vector/i, universalType: 'vector', native: true },

    // Binary types
    { pattern: /^binary/i, universalType: 'binary', native: true },
    { pattern: /^varbinary/i, universalType: 'binary', native: true },
    { pattern: /^image$/i, universalType: 'binary', native: true },
    { pattern: /^rowversion$/i, universalType: 'binary', native: true },
    { pattern: /^timestamp$/i, universalType: 'binary', native: true },

    // XML → custom
    { pattern: /^xml$/i, universalType: 'custom', native: true },
    { pattern: /^sql_variant$/i, universalType: 'custom', native: true },
    { pattern: /^hierarchyid$/i, universalType: 'custom', native: true },

    // Text types (large variable-length text with smart compression)
    { pattern: /^nvarchar\(max\)$/i, universalType: 'text', native: true },
    { pattern: /^varchar\(max\)$/i, universalType: 'text', native: true },
    { pattern: /^ntext$/i, universalType: 'text', native: true },
    { pattern: /^text$/i, universalType: 'text', native: true },

    // String types (short text-like types)
    { pattern: /^nvarchar/i, universalType: 'string', native: true },
    { pattern: /^varchar/i, universalType: 'string', native: true },
    { pattern: /^nchar/i, universalType: 'string', native: true },
    { pattern: /^char/i, universalType: 'string', native: true },

    // Everything else → custom
    { pattern: /.*/, universalType: 'custom', native: false },
];

/**
 * Get MSSQL target type for a universal type, version-aware.
 *
 * SQL Server 2025+ supports native JSON and VECTOR types.
 * Earlier versions use NVARCHAR(MAX) as workaround.
 *
 * @param universalType - The universal type to map
 * @param version - Target MSSQL version (optional)
 * @returns MSSQL type string
 */
export function getUniversalToMssql(universalType: UniversalType, version?: DatabaseVersion): string {

    const major = version?.major ?? 2022;

    switch (universalType) {

    case 'string':
        return 'nvarchar(255)';

    case 'text':
        return 'nvarchar(max)';

    case 'int':
        return 'int';

    case 'bigint':
        return 'bigint';

    case 'float':
        return 'float';

    case 'decimal':
        return 'decimal(38,10)';

    case 'bool':
        return 'bit';

    case 'timestamp':
        return 'datetime2(7)';

    case 'date':
        return 'date';

    case 'uuid':
        return 'uniqueidentifier';

    case 'json':
        // SQL Server 2025+ has native JSON
        return major >= 2025 ? 'json' : 'nvarchar(max)';

    case 'binary':
        return 'varbinary(max)';

    case 'vector':
        // SQL Server 2025+ has native VECTOR
        return major >= 2025 ? 'vector(1998)' : 'nvarchar(max)';

    case 'array':
        return 'nvarchar(max)';

    case 'custom':
        return 'nvarchar(max)';

    default:
        return 'nvarchar(max)';

    }

}
