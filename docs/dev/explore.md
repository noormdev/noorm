# Explore


## The Problem

You've run your schema builds and changes. The database says "success." But did everything actually get created? Are the columns right? Do the foreign keys point where they should?

Connecting via pgAdmin, MySQL Workbench, or Azure Data Studio works, but it breaks your flow. You're in the terminal. You want to stay there.

noorm's explore module gives you read-only schema introspection directly from the CLI. Browse tables, views, procedures, functions, types, indexes, foreign keys, triggers, locks, and connections across PostgreSQL, MySQL, MSSQL, and SQLite—all without leaving your workflow.


## How It Works

The explore module queries each database's system catalogs:

| Dialect | System Catalog |
|---------|----------------|
| PostgreSQL | `information_schema`, `pg_catalog` |
| MySQL | `information_schema` |
| MSSQL | `sys.*`, `information_schema` |
| SQLite | `sqlite_master`, `pragma_*` |

Three levels of detail:

1. **Overview** - Counts of each object type
2. **List** - Summaries for browsing (name, column count, etc.)
3. **Detail** - Full object metadata (columns, indexes, constraints)


## Quick Start

```typescript
import { fetchOverview, fetchList, fetchDetail } from './core/explore'

// Get counts of all object types
const overview = await fetchOverview(db, 'postgres')
console.log(`Tables: ${overview.tables}`)
console.log(`Views: ${overview.views}`)

// List all tables with summaries
const tables = await fetchList(db, 'postgres', 'tables')
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`)
}

// Get full table detail
const detail = await fetchDetail(db, 'postgres', 'tables', 'users', 'public')
if (detail) {
    for (const col of detail.columns) {
        console.log(`  ${col.name}: ${col.dataType}${col.isNullable ? '' : ' NOT NULL'}`)
    }
}
```


## Object Categories

Ten categories of database objects can be explored (`ExploreCategory` in `src/core/explore/types.ts:12`):

| Category | Summary Info | Detail Info |
|----------|--------------|-------------|
| `tables` | Column count, row estimate | Columns, indexes, foreign keys |
| `views` | Column count, updatable flag | Columns, definition SQL |
| `procedures` | Parameter count | Parameters, definition SQL |
| `functions` | Parameters, return type | Parameters, return type, definition |
| `types` | Kind (enum/composite/domain), value count | Values, attributes, base type |
| `indexes` | Table, columns, unique/primary flags | — (list only) |
| `foreignKeys` | Source → target table, columns | — (list only) |
| `triggers` | Table, timing, events | Timing, events, definition, enabled flag |
| `locks` | PID, lock type, mode, granted flag | — (list only) |
| `connections` | PID, user, database, state | — (list only) |

`locks` and `connections` describe the live server session, not the schema. They take no `schema` filter — `listLocks(db)` / `listConnections(db)` are the only dialect methods without one.


## Overview

Get counts of all object types in one call:

```typescript
const overview = await fetchOverview(db, 'postgres')

// {
//     tables: 24,
//     views: 5,
//     procedures: 3,
//     functions: 12,
//     types: 8,
//     indexes: 47,
//     foreignKeys: 18,
//     triggers: 4,
//     locks: 2,
//     connections: 6
// }
```

Counts come from the same list calls the detail views use, so the overview can never disagree with what drilling in shows.

By default, noorm internal tables (`__noorm_*`) are excluded from counts. Include them with:

```typescript
const overview = await fetchOverview(db, 'postgres', { includeNoormTables: true })
```

`includeNoormTables` only affects the prefixed `__noorm_*` names used on MySQL and SQLite. On PostgreSQL and SQL Server the tracking tables live in a dedicated `noorm` schema, which every dialect query excludes outright — the flag cannot bring them back.

Both `fetchOverview` and `fetchList` also accept `schema` to narrow results to one schema. It reaches the generated SQL rather than filtering afterwards, and it throws on SQLite, which has no schemas.

```typescript
const overview = await fetchOverview(db, 'postgres', { schema: 'reporting' })
```


## Lists

Fetch summary information for browsing:

```typescript
// List all tables
const tables = await fetchList(db, 'postgres', 'tables')
// [
//     { name: 'users', schema: 'public', columnCount: 8, rowCountEstimate: 1500 },
//     { name: 'posts', schema: 'public', columnCount: 5, rowCountEstimate: 42000 },
//     ...
// ]

// List all functions
const functions = await fetchList(db, 'postgres', 'functions')
// [
//     { name: 'calculate_total', schema: 'public', parameterCount: 2, returnType: 'numeric' },
//     ...
// ]

// List foreign keys
const foreignKeys = await fetchList(db, 'postgres', 'foreignKeys')
// [
//     {
//         name: 'posts_user_id_fkey',
//         tableName: 'posts',
//         columns: ['user_id'],
//         referencedTable: 'users',
//         referencedColumns: ['id'],
//         onDelete: 'CASCADE',
//         onUpdate: 'NO ACTION'
//     },
//     ...
// ]
```


## Details

Get full metadata for a specific object:

```typescript
// Table detail
const table = await fetchDetail(db, 'postgres', 'tables', 'users', 'public')

// {
//     name: 'users',
//     schema: 'public',
//     columns: [
//         { name: 'id', dataType: 'uuid', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
//         { name: 'email', dataType: 'varchar(255)', isNullable: false, isPrimaryKey: false, ordinalPosition: 2 },
//         { name: 'created_at', dataType: 'timestamptz', isNullable: false, defaultValue: 'now()', ... },
//     ],
//     indexes: [
//         { name: 'users_pkey', columns: ['id'], isUnique: true, isPrimary: true },
//         { name: 'users_email_idx', columns: ['email'], isUnique: true, isPrimary: false },
//     ],
//     foreignKeys: [],
//     rowCountEstimate: 1500
// }

// View detail (includes definition)
const view = await fetchDetail(db, 'postgres', 'views', 'active_users')

// {
//     name: 'active_users',
//     columns: [...],
//     definition: 'SELECT id, email FROM users WHERE active = true',
//     isUpdatable: false
// }

// Function detail
const fn = await fetchDetail(db, 'postgres', 'functions', 'calculate_total')

// {
//     name: 'calculate_total',
//     parameters: [
//         { name: 'price', dataType: 'numeric', mode: 'IN', ordinalPosition: 1 },
//         { name: 'quantity', dataType: 'integer', mode: 'IN', ordinalPosition: 2 },
//     ],
//     returnType: 'numeric',
//     definition: 'BEGIN RETURN price * quantity; END;'
// }
```


## Type Definitions

### Summary Types

```typescript
interface TableSummary {
    name: string
    schema?: string
    columnCount: number
    rowCountEstimate?: number
}

interface ViewSummary {
    name: string
    schema?: string
    columnCount: number
    isUpdatable: boolean
}

interface FunctionSummary {
    name: string
    schema?: string
    parameterCount: number
    returnType: string
}

interface IndexSummary {
    name: string
    schema?: string
    tableName: string
    tableSchema?: string
    columns: string[]
    isUnique: boolean
    isPrimary: boolean
}

interface ForeignKeySummary {
    name: string
    schema?: string
    tableName: string
    tableSchema?: string
    columns: string[]
    referencedTable: string
    referencedSchema?: string
    referencedColumns: string[]
    onDelete?: string
    onUpdate?: string
}

interface TriggerSummary {
    name: string
    schema?: string
    tableName: string
    tableSchema?: string
    timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF'
    events: ('INSERT' | 'UPDATE' | 'DELETE')[]
}
```

### Detail Types

```typescript
interface ColumnDetail {
    name: string
    dataType: string
    isNullable: boolean
    defaultValue?: string
    isPrimaryKey: boolean
    ordinalPosition: number
}

interface TableDetail {
    name: string
    schema?: string
    columns: ColumnDetail[]
    indexes: IndexSummary[]
    foreignKeys: ForeignKeySummary[]
    rowCountEstimate?: number
}

interface ViewDetail {
    name: string
    schema?: string
    columns: ColumnDetail[]
    definition?: string
    isUpdatable: boolean
}
```


## Formatting Helpers

The module includes a helper for generating human-readable summaries:

```typescript
import { formatSummaryDescription } from './core/explore'

formatSummaryDescription('tables', { name: 'users', columnCount: 8, rowCountEstimate: 1500 })
// "8 columns, ~1.5K rows"

formatSummaryDescription('functions', { name: 'calc', parameterCount: 2, returnType: 'numeric' })
// "2 params → numeric"

formatSummaryDescription('indexes', { name: 'idx', tableName: 'users', isPrimary: true })
// "on users, PRIMARY"
```


## Dialect Support

Categories translate per dialect; unsupported ones return an empty array rather than throwing:

| Feature | PostgreSQL | MySQL | MSSQL | SQLite |
|---------|------------|-------|-------|--------|
| Tables | ✓ | ✓ | ✓ | ✓ |
| Views | ✓ | ✓ | ✓ | ✓ |
| Procedures | ✓ | ✓ | ✓ | — |
| Functions | ✓ | ✓ | ✓ | — |
| Types | ✓ (enum, composite, domain) | — | ✓ (alias, table types) | — |
| Indexes | ✓ | ✓ | ✓ | ✓ |
| Foreign Keys | ✓ | ✓ | ✓ | ✓ |
| Triggers | ✓ | ✓ | ✓ | ✓ |
| Locks | ✓ | ✓ (`performance_schema`) | ✓ | — |
| Connections | ✓ | ✓ | ✓ | — |

SQLite doesn't support stored procedures, functions, or user-defined types, and has no server-side lock or connection views. MySQL doesn't support user-defined types, and its lock listing needs `SELECT` on `performance_schema` — without the grant it degrades to an empty list rather than failing the call.


## CLI Integration

Access explore functionality through the CLI:

1. Press `d` from home to enter the database menu
2. Select a config with an active connection
3. Use explore screens to browse schema:
   - Overview shows counts of each object type
   - List screens show all objects in a category
   - Detail screens show full metadata

Keyboard shortcuts:

| Key | Action |
|-----|--------|
| `x` | Enter explore mode (from the database screen) |
| `↑/↓` | Navigate lists |
| `Enter` | View detail |
| `Esc` | Go back |


## Best Practices

1. **Verify builds** - After running schema builds, use explore to confirm tables, views, and functions were created correctly.

2. **Check constraints** - Browse foreign keys to verify referential integrity is set up as expected.

3. **Inspect indexes** - Review index coverage before and after adding new queries.

4. **Compare environments** - Run overview on dev vs prod to spot schema drift.

5. **Debug changes** - When changes fail, explore the current schema state to understand what exists.
