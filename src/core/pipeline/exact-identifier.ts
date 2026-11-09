import { sql } from 'kysely';

import type { Dialect } from '../connection/types.js';

/** Compare identifier bytes rather than relying on the database's default collation. */
export function exactIdentifier(dialect: Dialect, column: 'config_name' | 'slug', value: string) {

    const ref = sql.ref(column);
    if (dialect === 'mssql') {

        // Convert both to the same encoding and compare lengths to prevent padding aliases.
        return sql<boolean>`CONVERT(varbinary(max), CONVERT(nvarchar(max), ${ref})) = CONVERT(varbinary(max), CONVERT(nvarchar(max), ${value}))
            AND DATALENGTH(CONVERT(nvarchar(max), ${ref})) = DATALENGTH(CONVERT(nvarchar(max), ${value}))`;

    }
    if (dialect === 'mysql') return sql<boolean>`CAST(${ref} AS BINARY) = CAST(${value} AS BINARY)`;
    if (dialect === 'postgres') return sql<boolean>`convert_to(${ref}, 'UTF8') = convert_to(${value}, 'UTF8')`;

    return sql<boolean>`CAST(${ref} AS BLOB) = CAST(${value} AS BLOB)`;

}
