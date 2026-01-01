# TODO: Test Coverage Plan


## Overview

This document outlines the testing requirements for noorm. The codebase has grown significantly with new features that require both unit tests and integration tests against live databases.

**Current State (Updated 2025-12-31):**

- 68 test files covering 16 of 18 core modules
- ✅ explore, teardown, sql-terminal modules now have full test coverage
- ✅ Infrastructure complete: docker-compose.test.yml, test utilities, fixture schemas
- 2 modules still need tests (db, shared)
- 24 new CLI screens without integration coverage


## ✅ COMPLETED: Priority Items 1-4

The following high-priority items have been implemented:

| Item | Status | Test Files | Tests |
|------|--------|------------|-------|
| Docker Compose setup | ✅ Complete | `docker-compose.test.yml` | - |
| Test utilities | ✅ Complete | `tests/utils/db.ts` | - |
| Fixture schemas | ✅ Complete | `tests/fixtures/schema/{dialect}/*.sql` | - |
| explore module | ✅ Complete | 5 files (unit + 4 integration) | 38 unit + integration |
| teardown module | ✅ Complete | 6 files (unit + 4 integration) | 113 unit + integration |
| sql-terminal module | ✅ Complete | 6 files (unit + 4 integration) | 53 unit + integration |

**Total new tests: 204 unit tests + 12 integration test files**


---


## ✅ Infrastructure Requirements (COMPLETE)


### ✅ Docker Compose Setup

Docker Compose configuration is complete at `docker-compose.test.yml`:

**Why:** Dialect-specific code (explore, teardown, db lifecycle) generates different SQL for each database. Unit tests with mocks cannot verify that the generated SQL is valid. We need live databases to confirm queries work in production.

**Databases Required:**

- PostgreSQL 15+
- MySQL 8.0+
- Microsoft SQL Server 2019+
- SQLite (file-based, no container needed)

**Container Requirements:**

- Health checks for connection readiness
- Persistent volumes for test fixtures
- Network isolation for parallel test runs
- Quick teardown between test suites


### Test Fixtures

**Why:** Integration tests need consistent starting states. Seed data allows testing of complex scenarios like foreign key constraints, triggers, and stored procedures.

**Fixtures Needed:**

- Empty database state
- Database with basic schema (tables, indexes, foreign keys)
- Database with sample data for query testing
- Database with stored procedures and functions (Postgres, MySQL, MSSQL)
- Database with views and triggers


### Test SQL Files

**Why:** The runner module executes SQL files with templating. We need actual SQL files to test execution paths.

**Files Needed:**

- Simple SQL files for basic execution tests
- Templated SQL files with Eta syntax
- SQL files with errors for error handling tests
- Multi-statement SQL files for transaction tests
- Dialect-specific SQL files for cross-database tests


---


## Reference Test Schema

All integration tests will use a consistent "Todo App" schema across all four databases. This ensures we test the exact same objects and can verify the explore module returns identical results.

**Source:** Based on `/Users/alonso/projects/experiments/a-sql-proj/schema`


### Schema Objects

**Tables (3):**

| Table | Columns | Features |
|-------|---------|----------|
| `users` | id (UUID PK), email, username, password_hash, display_name, avatar_url, created_at, updated_at, deleted_at | Unique constraints, partial indexes, soft delete |
| `todo_lists` | id (UUID PK), user_id (FK), title, description, color, position, created_at, updated_at, deleted_at | FK with CASCADE, position ordering |
| `todo_items` | id (UUID PK), list_id (FK), title, description, is_completed, priority, due_date, completed_at, position, created_at, updated_at, deleted_at | FK with CASCADE, check constraint (priority 0-3), multiple indexes |

**Views (3):**

| View | Description |
|------|-------------|
| `v_active_users` | Filters soft-deleted users |
| `v_todo_lists_with_counts` | Aggregates item counts per list |
| `v_active_todo_items` | Joins items with lists, filters deleted |

**Functions/Procedures (15):**

| Category | Functions |
|----------|-----------|
| Users | `create_user`, `get_user_by_id`, `get_user_by_email`, `update_user`, `delete_user` |
| Todo Lists | `create_todo_list`, `get_todo_list_by_id`, `get_todo_lists_by_user`, `update_todo_list`, `delete_todo_list` |
| Todo Items | `create_todo_item`, `get_todo_item_by_id`, `get_todo_items_by_list`, `update_todo_item`, `toggle_todo_item`, `delete_todo_item` |

**Indexes (8):**

- `idx_users_email` - partial index on email where not deleted
- `idx_users_username` - partial index on username where not deleted
- `idx_todo_lists_user_id` - partial index on user_id where not deleted
- `idx_todo_lists_position` - composite partial index on (user_id, position)
- `idx_todo_items_list_id` - partial index on list_id where not deleted
- `idx_todo_items_position` - composite partial index on (list_id, position)
- `idx_todo_items_due_date` - partial index on due_date where not deleted and not completed

**Constraints:**

- Primary keys on all tables (UUID)
- Foreign keys: `todo_lists.user_id` → `users.id`, `todo_items.list_id` → `todo_lists.id`
- Unique constraints on `users.email` and `users.username`
- Check constraint on `todo_items.priority` (0-3 range)


### Dialect Adaptations Required

Each database requires dialect-specific SQL files in `tests/fixtures/schema/{dialect}/`:

**PostgreSQL:**

- Use as-is from reference (native syntax)
- Uses `gen_random_uuid()` for UUID generation
- Uses `TIMESTAMPTZ` for timestamps
- Uses `CREATE OR REPLACE FUNCTION` with `LANGUAGE plpgsql`
- Partial indexes supported natively

**MySQL:**

- Replace `UUID` with `CHAR(36)` or `BINARY(16)`
- Replace `gen_random_uuid()` with `UUID()` function
- Replace `TIMESTAMPTZ` with `TIMESTAMP`
- Convert functions to `CREATE PROCEDURE` (MySQL functions have limitations)
- Partial indexes not supported - use regular indexes
- Replace `FILTER (WHERE ...)` with `CASE WHEN` in aggregates

**MSSQL:**

- Replace `UUID` with `UNIQUEIDENTIFIER`
- Replace `gen_random_uuid()` with `NEWID()`
- Replace `TIMESTAMPTZ` with `DATETIMEOFFSET`
- Convert functions to stored procedures using `CREATE PROCEDURE`
- Partial indexes → filtered indexes with `WHERE` clause
- Add custom user-defined types (see below)

**SQLite:**

- Replace `UUID` with `TEXT` (SQLite has no UUID type)
- Generate UUIDs in application code or use `hex(randomblob(16))`
- Replace `TIMESTAMPTZ` with `TEXT` (ISO 8601 strings)
- No stored procedures - use views or application logic
- Partial indexes supported since SQLite 3.8.0
- No `CREATE OR REPLACE` - use `DROP IF EXISTS` + `CREATE`


### MSSQL Custom Types (Required)

**Why:** SQL Server has many system types. To verify the explore module correctly identifies user-created types vs system types, we must create custom types and ensure only those appear in results.

**Types to Create:**

```
EmailAddress     - VARCHAR(255) with format validation
Username         - VARCHAR(100) constrained
HexColor         - CHAR(7) for color codes like #FFFFFF
Priority         - TINYINT constrained to 0-3
SoftDeleteDate   - DATETIMEOFFSET nullable for soft delete pattern
```

**Usage in Schema:**

- `users.email` → `EmailAddress`
- `users.username` → `Username`
- `todo_lists.color` → `HexColor`
- `todo_items.priority` → `Priority`
- `*.deleted_at` → `SoftDeleteDate`

**Test Assertions:**

- Explore should list exactly 5 user-defined types for MSSQL
- Types should show correct base type and constraints
- System types (int, varchar, etc.) should NOT appear in type list


### MSSQL Scalar Functions (Required)

**Why:** SQL Server supports scalar functions that can be used in CHECK constraints and computed columns. This tests that explore correctly identifies user-defined scalar functions vs system functions.

**Functions to Create:**

```
fn_IsValidEmail(email VARCHAR(255)) RETURNS BIT
    - Returns 1 if email matches basic pattern (contains @ and .)
    - Returns 0 otherwise
    - Used in CHECK constraint on users.email

fn_IsValidHexColor(color CHAR(7)) RETURNS BIT
    - Returns 1 if color matches #RRGGBB pattern
    - Returns 0 otherwise
    - Used in CHECK constraint on todo_lists.color

fn_GetPriorityLabel(priority TINYINT) RETURNS VARCHAR(10)
    - Returns 'None' for 0, 'Low' for 1, 'Medium' for 2, 'High' for 3
    - Used in computed column on todo_items.priority_label
```

**Usage in Schema:**

- `users` table: `CHECK (dbo.fn_IsValidEmail(email) = 1)`
- `todo_lists` table: `CHECK (color IS NULL OR dbo.fn_IsValidHexColor(color) = 1)`
- `todo_items` table: `priority_label AS (dbo.fn_GetPriorityLabel(priority))` (computed column)

**Test Assertions:**

- Explore should list exactly 3 scalar functions for MSSQL
- Functions should show parameter types and return type
- Functions should show function body containing the logic
- System functions (GETDATE, NEWID, etc.) should NOT appear in function list
- Computed column `priority_label` should reference `fn_GetPriorityLabel`


### Expected Test Results

After applying the schema, explore should return:

| Category | PostgreSQL | MySQL | MSSQL | SQLite |
|----------|------------|-------|-------|--------|
| Tables | 3 | 3 | 3 | 3 |
| Views | 3 | 3 | 3 | 3 |
| Functions | 15 | 0 | 3 | 0 |
| Procedures | 0 | 15 | 15 | 0 |
| Types | 0 | 0 | 5 | 0 |
| Indexes | 8+ | 8 | 8 | 8 |

**Notes:**
- PostgreSQL uses functions for CRUD operations (15 plpgsql functions)
- MySQL uses procedures for CRUD operations (functions have limitations)
- MSSQL uses procedures for CRUD (15) + scalar functions for validation/computed (3)
- SQLite has no stored procedure/function support


---


## ✅ Module: explore (COMPLETE - 3,700 lines)

The explore module provides read-only database schema introspection across all dialects.

**Test Files:**
- `tests/core/explore/operations.test.ts` - 38 tests for `formatSummaryDescription`
- `tests/integration/explore/postgres.test.ts` - fetchOverview, fetchList, fetchDetail
- `tests/integration/explore/mysql.test.ts` - MySQL-specific behavior
- `tests/integration/explore/mssql.test.ts` - types, scalar functions, procedures
- `tests/integration/explore/sqlite.test.ts` - SQLite limitations


### Feature: Fetch database overview

**Why:** Users need a quick summary of what exists in their database before drilling down.

- It should return exactly 3 tables for the test schema
- It should return exactly 3 views for the test schema
- It should return 15 functions for PostgreSQL test schema (plpgsql CRUD functions)
- It should return 15 procedures for MySQL test schema (CRUD procedures)
- It should return 15 procedures AND 3 functions for MSSQL test schema (CRUD procedures + scalar validation functions)
- It should return 0 functions/procedures for SQLite test schema
- It should return 5 user-defined types for MSSQL test schema
- It should return zero counts for an empty database
- It should only count objects in the target schema, not system schemas
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: List tables

**Why:** Table listing is the primary navigation for database exploration.

- It should return users, todo_lists, and todo_items tables
- It should include table name and schema for each table
- It should include row count estimate for each table (0 for empty)
- It should return 10 columns for users table
- It should return 10 columns for todo_lists table
- It should return 13 columns for todo_items table (14 for MSSQL with computed column)
- It should exclude system tables from results
- It should sort tables alphabetically by default
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: List views

**Why:** Views are commonly used and need to be discoverable.

- It should return v_active_users, v_todo_lists_with_counts, and v_active_todo_items views
- It should include the view definition SQL containing the SELECT statement
- It should exclude system views from results
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: List stored procedures

**Why:** Stored procedures are critical for some database workflows.

- It should return 15 procedures for MySQL test schema
- It should return 15 procedures for MSSQL test schema
- It should include parameter names and types for create_user procedure
- It should include the procedure body containing INSERT/UPDATE/DELETE statements
- It should exclude system procedures from results
- It should return 0 procedures for PostgreSQL (uses functions instead)
- It should return 0 procedures for SQLite (not supported)


### Feature: List functions

**Why:** User-defined functions need to be discoverable for debugging and documentation.

**PostgreSQL (15 plpgsql functions):**

- It should return 15 functions for PostgreSQL test schema
- It should include create_user function with 5 parameters
- It should include get_user_by_id function returning TABLE type
- It should include the function body containing plpgsql code
- It should exclude built-in functions (gen_random_uuid, NOW, etc.)

**MSSQL (3 scalar functions):**

- It should return 3 scalar functions for MSSQL test schema
- It should include fn_IsValidEmail with parameter (email VARCHAR(255)) returning BIT
- It should include fn_IsValidHexColor with parameter (color CHAR(7)) returning BIT
- It should include fn_GetPriorityLabel with parameter (priority TINYINT) returning VARCHAR(10)
- It should show function body containing validation/transformation logic
- It should distinguish scalar functions from stored procedures
- It should exclude system functions (GETDATE, NEWID, LEN, etc.)

**MySQL and SQLite:**

- It should return 0 functions for MySQL (uses procedures instead)
- It should return 0 functions for SQLite (not supported)


### Feature: List user-defined types

**Why:** Custom types are important for MSSQL schema understanding.

- It should return 5 types for MSSQL test schema (EmailAddress, Username, HexColor, Priority, SoftDeleteDate)
- It should include base type for each custom type
- It should NOT include system types like INT, VARCHAR, DATETIME
- It should return 0 types for PostgreSQL (no custom types in test schema)
- It should return 0 types for MySQL (no custom types in test schema)
- It should return 0 types for SQLite (not supported)


### Feature: Fetch table details for users table

**Why:** Detailed table metadata is essential for understanding schema structure.

- It should return 10 columns (id, email, username, password_hash, display_name, avatar_url, created_at, updated_at, deleted_at)
- It should identify id as UUID/UNIQUEIDENTIFIER primary key
- It should identify email as VARCHAR(255) NOT NULL
- It should identify deleted_at as nullable timestamp
- It should show default value gen_random_uuid() for id column (PostgreSQL)
- It should show default value NOW() for created_at column
- It should return idx_users_email and idx_users_username indexes
- It should show the partial index condition (WHERE deleted_at IS NULL) for PostgreSQL
- It should show filtered index condition for MSSQL
- It should show unique constraint on email column
- It should show unique constraint on username column
- It should return 0 foreign keys (users has no FK references)
- For MSSQL: It should show CHECK constraint referencing fn_IsValidEmail function
- For MSSQL: It should show email column uses EmailAddress custom type
- For MSSQL: It should show username column uses Username custom type
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Fetch table details for todo_lists table

**Why:** Tests foreign key introspection and function-based CHECK constraints.

- It should return 10 columns
- It should identify user_id as foreign key to users.id
- It should show ON DELETE CASCADE behavior for user_id FK
- It should return idx_todo_lists_user_id and idx_todo_lists_position indexes
- It should show composite index on (user_id, position)
- For MSSQL: It should show CHECK constraint referencing fn_IsValidHexColor function
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Fetch table details for todo_items table

**Why:** Tests check constraints, computed columns, and multiple indexes.

- It should return 13 columns (14 for MSSQL with computed column)
- It should identify list_id as foreign key to todo_lists.id
- It should show check constraint on priority (0-3 range)
- It should return idx_todo_items_list_id, idx_todo_items_position, idx_todo_items_due_date indexes
- It should show partial index with compound condition (deleted_at IS NULL AND is_completed = FALSE)
- It should show is_completed as BOOLEAN/BIT type
- For MSSQL: It should show priority_label as computed column
- For MSSQL: It should show computed column expression references fn_GetPriorityLabel
- For MSSQL: It should identify priority_label as non-persisted computed column
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Fetch view details

**Why:** Understanding view structure helps with query optimization and debugging.

- It should return the view definition SQL for v_active_users
- It should show v_active_users references users table
- It should return columns for v_todo_lists_with_counts including total_items, completed_items, pending_items
- It should show v_todo_lists_with_counts references both todo_lists and todo_items tables
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Fetch function/procedure details

**Why:** Understanding function signatures and bodies aids debugging.

- It should return parameter list for create_user (p_email, p_username, p_password_hash, p_display_name, p_avatar_url)
- It should show return type UUID for create_user
- It should return TABLE return type for get_user_by_id
- It should include the function body with INSERT statement for create_user
- It should include the function body with SELECT statement for get_user_by_id
- It should work correctly for PostgreSQL functions
- It should work correctly for MySQL procedures
- It should work correctly for MSSQL procedures


### Feature: Handle edge cases

**Why:** Real databases have edge cases that can break naive implementations.

- It should handle empty database gracefully (zero counts)
- It should handle tables with very long names (63+ characters)
- It should handle tables with special characters in names (quoted identifiers)
- It should handle self-referencing foreign keys
- It should handle composite primary keys
- It should handle composite foreign keys
- It should handle tables with generated/computed columns
- It should handle tables with identity/auto-increment columns


---


## ✅ Module: teardown (COMPLETE - 654 lines)

The teardown module provides fast database reset without dropping/recreating the database.

**Test Files:**
- `tests/core/teardown/operations.test.ts` - 7 tests for `isNoormTable`
- `tests/core/teardown/dialects/postgres.test.ts` - 30 tests for SQL generation
- `tests/core/teardown/dialects/mysql.test.ts` - 23 tests for SQL generation
- `tests/core/teardown/dialects/mssql.test.ts` - 30 tests for SQL generation
- `tests/core/teardown/dialects/sqlite.test.ts` - 23 tests for SQL generation
- `tests/integration/teardown/postgres.test.ts` - truncateData, teardownSchema, previewTeardown
- `tests/integration/teardown/mysql.test.ts` - MySQL FK handling
- `tests/integration/teardown/mssql.test.ts` - MSSQL type/procedure drops
- `tests/integration/teardown/sqlite.test.ts` - DELETE instead of TRUNCATE


### Feature: Truncate data

**Why:** Tests need to reset data quickly without rebuilding schema.

- Given test schema with seed data (10 users, 25 todo_lists, 100 todo_items)
- It should remove all 100 rows from todo_items
- It should remove all 25 rows from todo_lists
- It should remove all 10 rows from users
- It should truncate in correct order (todo_items → todo_lists → users) due to FK constraints
- It should reset identity/auto-increment counters to initial values
- It should handle empty tables gracefully (no error)
- It should report row counts: {users: 10, todo_lists: 25, todo_items: 100}
- It should leave schema intact (tables, views, functions still exist)
- It should work correctly for PostgreSQL (TRUNCATE CASCADE)
- It should work correctly for MySQL (SET FOREIGN_KEY_CHECKS=0)
- It should work correctly for MSSQL (DELETE in dependency order)
- It should work correctly for SQLite (DELETE in dependency order)


### Feature: Teardown schema

**Why:** Sometimes tests need a completely empty database state.

- It should drop all 3 tables (users, todo_lists, todo_items)
- It should drop all 3 views (v_active_users, v_todo_lists_with_counts, v_active_todo_items)
- It should drop all 15 procedures for MySQL/MSSQL
- It should drop all 15 functions for PostgreSQL
- It should drop all 5 custom types for MSSQL
- It should drop all 8 indexes (dropped automatically with tables)
- It should drop in correct dependency order (todo_items → todo_lists → users)
- It should leave system objects intact
- It should result in empty overview (0 tables, 0 views, 0 functions, 0 types)
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Preview teardown

**Why:** Users should be able to see what will be affected before making destructive changes.

- It should return 3 tables that will be dropped
- It should return 3 views that will be dropped
- It should return 15 procedures/functions that will be dropped
- It should return row counts: {users: 10, todo_lists: 25, todo_items: 100}
- It should show dependency order for drops
- It should work in dry-run mode without making any changes
- It should leave database unchanged after preview


### Feature: Handle constraints safely

**Why:** Constraint handling is the most error-prone part of database teardown.

- It should handle FK from todo_items.list_id → todo_lists.id
- It should handle FK from todo_lists.user_id → users.id
- It should handle ON DELETE CASCADE constraints correctly
- It should disable foreign key checks during truncation on MySQL
- It should use TRUNCATE CASCADE on PostgreSQL
- It should delete in correct dependency order on MSSQL
- It should rollback entire operation if any step fails
- It should report which table/constraint caused a failure
- It should handle unique constraints on users.email and users.username


---


## ✅ Module: sql-terminal (COMPLETE - 542 lines)

The sql-terminal module provides an interactive SQL REPL with history persistence.

**Test Files:**
- `tests/core/sql-terminal/history.test.ts` - 40 tests for `SqlHistoryManager`
- `tests/core/sql-terminal/executor.test.ts` - 13 tests for `executeRawSql` with mocked db
- `tests/integration/sql-terminal/postgres.test.ts` - RETURNING clause, CTEs, window functions
- `tests/integration/sql-terminal/mysql.test.ts` - CALL procedure, SHOW commands
- `tests/integration/sql-terminal/mssql.test.ts` - TOP, WAITFOR, OUTPUT clause
- `tests/integration/sql-terminal/sqlite.test.ts` - PRAGMA, transactions


### Feature: Execute raw SQL

**Why:** Users need to run arbitrary SQL queries for debugging and exploration.

- It should execute `SELECT * FROM users` and return all columns
- It should execute `SELECT id, email FROM users WHERE deleted_at IS NULL` and return 2 columns
- It should execute `INSERT INTO users (email, username, password_hash) VALUES (...)` and return 1 affected row
- It should execute `UPDATE users SET display_name = 'Test' WHERE id = ?` and return affected row count
- It should execute `DELETE FROM todo_items WHERE list_id = ?` and return affected row count
- It should execute `CREATE TABLE test_temp (id INT)` and return success
- It should execute `DROP TABLE test_temp` and return success
- It should handle multi-statement input (INSERT then SELECT)
- It should return column names: id, email, username, password_hash, display_name, avatar_url, created_at, updated_at, deleted_at
- It should handle NULL values in display_name and avatar_url correctly
- It should handle UUID values in id column correctly
- It should handle timestamp values in created_at correctly
- It should enforce query timeouts (configurable, default 30s)
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Handle SQL errors

**Why:** Users need clear error messages to debug their queries.

- It should return syntax error for `SELEC * FROM users` (typo)
- It should return "table not found" for `SELECT * FROM nonexistent`
- It should return FK violation for inserting todo_list with invalid user_id
- It should return unique constraint violation for duplicate email
- It should return check constraint violation for priority = 5 (out of range)
- It should return timeout error for long-running queries
- It should NOT expose connection password in error messages


### Feature: Persist query history

**Why:** Users want to recall and rerun previous queries.

- It should save executed queries to history
- It should save query execution time
- It should save query results (compressed)
- It should limit history size to prevent disk bloat
- It should load history on initialization
- It should handle concurrent writes safely
- It should handle corrupted history files gracefully


### Feature: Manage history

**Why:** Users need to clean up and organize their history.

- It should clear all history for a config
- It should delete individual history entries
- It should list history entries with timestamps
- It should retrieve a specific history entry by ID
- It should search history by query text


### Feature: Handle result storage

**Why:** Large results need efficient storage and retrieval.

- It should compress results using gzip
- It should decompress results on retrieval
- It should handle results larger than available memory
- It should respect maximum result size limits
- It should truncate oversized results with a warning


---


## Module: db (NO TESTS)

The db module handles database lifecycle operations (create/destroy).


### Feature: Create database

**Why:** Tests and development workflows need to create databases programmatically.

- It should create a new database with the specified name
- It should set the correct character encoding
- It should set the correct collation
- It should grant permissions to the configured user
- It should handle existing database gracefully
- It should validate database name characters
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Destroy database

**Why:** Cleanup after tests requires reliable database destruction.

- It should drop the database completely
- It should terminate active connections before dropping
- It should handle non-existent database gracefully
- It should not drop system databases
- It should require confirmation for production databases
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite (delete file)


### Feature: Test connection

**Why:** Configuration validation needs to verify database connectivity.

- It should verify credentials are valid
- It should verify network connectivity
- It should verify database exists
- It should support server-only mode for setup wizards
- It should timeout after reasonable duration
- It should return specific error for auth failure
- It should return specific error for network failure
- It should return specific error for missing database


---


## Module: shared (NO TESTS)

The shared module contains utilities and constants used across all modules.


### Feature: File utilities

**Why:** File operations are used throughout the codebase and need to be reliable.

- It should read files with correct encoding
- It should handle missing files gracefully
- It should handle permission errors gracefully
- It should handle binary files correctly


### Feature: Table definitions

**Why:** Shared table types ensure consistency across modules.

- It should export correct table names for internal tables
- It should maintain backwards compatibility for table names
- It should work with all dialect-specific implementations


---


## Module: changeset (PARTIALLY TESTED - needs integration tests)

The changeset module has unit tests but needs integration tests with real databases.


### Feature: Execute changesets against live database

**Why:** Changeset execution is the core feature and must work reliably across all dialects.

- It should apply a single changeset to an empty database
- It should apply multiple changesets in order
- It should record applied changesets in history table
- It should skip already-applied changesets
- It should handle changeset with multiple statements
- It should rollback failed changesets completely
- It should support dry-run mode
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Rollback changesets

**Why:** Failed deployments need reliable rollback capability.

- It should rollback a single changeset
- It should rollback multiple changesets in reverse order
- It should update history table after rollback
- It should handle rollback without down migration gracefully
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Changeset history

**Why:** Audit trail is critical for production databases.

- It should record timestamp of changeset application
- It should record user who applied changeset
- It should record changeset checksum
- It should detect when changeset file has been modified
- It should retrieve full history with metadata


---


## Module: runner (PARTIALLY TESTED - needs integration tests)

The runner module has unit tests but needs integration tests for template execution.


### Feature: Execute templated SQL files

**Why:** Templates are a core feature and must resolve correctly before execution.

- It should resolve simple template variables
- It should resolve nested template includes
- It should resolve environment variables in templates
- It should resolve settings values in templates
- It should fail clearly when template variable is missing
- It should work correctly for PostgreSQL
- It should work correctly for MySQL
- It should work correctly for MSSQL
- It should work correctly for SQLite


### Feature: Execute SQL files with data loaders

**Why:** Data loaders allow dynamic SQL generation from external data sources.

- It should load JSON data into templates
- It should load YAML data into templates
- It should load CSV data into templates
- It should handle missing data files gracefully
- It should handle malformed data files gracefully


### Feature: Track execution progress

**Why:** Long-running executions need progress visibility.

- It should emit progress events during execution
- It should report file-level progress
- It should report statement-level progress for multi-statement files
- It should report total execution time
- It should report individual statement execution time


---


## Module: connection (TESTED - needs dialect coverage)

The connection module has tests but may not cover all dialect edge cases.


### Feature: Dialect-specific connection handling

**Why:** Each database has unique connection requirements.

- It should handle PostgreSQL SSL modes correctly
- It should handle MySQL SSL configurations correctly
- It should handle MSSQL TrustServerCertificate correctly
- It should handle SQLite file paths correctly
- It should validate connection parameters per dialect
- It should provide helpful errors for common misconfigurations


### Feature: Connection pooling

**Why:** Production usage requires efficient connection management.

- It should reuse connections from pool
- It should respect maximum pool size
- It should handle pool exhaustion gracefully
- It should clean up idle connections
- It should handle connection failures during pooled operations


---


## Module: logger (TESTED - needs reader tests)

The logger module is well-tested but has a new reader component.


### Feature: Log file reading

**Why:** The new log viewer feature needs to read and filter logs.

- It should read log files with correct encoding
- It should parse log entries correctly
- It should filter logs by level
- It should filter logs by date range
- It should filter logs by module/source
- It should handle rotated log files
- It should handle corrupted log entries gracefully


---


## CLI Components


### Feature: SearchableList component

**Why:** Searchable lists are used throughout the UI for filtering large datasets.

- It should render all items when no search term is entered
- It should filter items by search term
- It should highlight matching text in results
- It should handle empty results gracefully
- It should maintain selection after filtering
- It should support keyboard navigation


### Feature: ResultTable component

**Why:** SQL results need to be displayed in a readable table format.

- It should render column headers correctly
- It should render rows with correct alignment
- It should handle NULL values visually
- It should handle very wide columns
- It should handle very long text values
- It should handle binary data display
- It should support pagination for large results


### Feature: SqlInput component

**Why:** Multi-line SQL input requires special handling.

- It should accept multi-line input
- It should preserve indentation
- It should support basic SQL syntax hints
- It should handle paste of large SQL blocks
- It should support keyboard shortcuts for execution


---


## Integration Test Scenarios

These scenarios require multiple modules working together with live databases. All scenarios use the Reference Test Schema.


### Scenario: Full changeset deployment workflow

**Why:** End-to-end workflow validation catches integration issues.

- Given a fresh empty database
- And changesets for users table, todo_lists table, todo_items table, views, and functions
- When the user runs changeset apply
- Then all changesets should be applied in order (001 → 002 → 003 → ...)
- And the history table should contain entries for each changeset with checksums
- And explore should show 3 tables, 3 views, 15 functions/procedures
- And the users table should have correct columns and constraints
- This should work for PostgreSQL, MySQL, MSSQL, and SQLite


### Scenario: Database exploration after deployment

**Why:** Explore should accurately reflect deployed schema.

- Given a database with the test schema deployed
- When the user fetches database overview
- Then it should return 3 tables, 3 views, correct function/procedure counts
- When the user lists tables
- Then it should return users, todo_lists, todo_items with correct column counts
- When the user fetches users table details
- Then it should show 10 columns, 2 indexes, 2 unique constraints, 0 foreign keys
- When the user fetches todo_items table details
- Then it should show 13 columns, FK to todo_lists, check constraint on priority
- This should work for PostgreSQL, MySQL, MSSQL, and SQLite


### Scenario: SQL terminal CRUD operations

**Why:** Terminal should support full data lifecycle.

- Given a database with the test schema (empty)
- When the user inserts a user via SQL terminal
- Then 1 affected row should be returned
- And the query should be saved to history
- When the user selects the inserted user
- Then the row should be returned with correct column values
- When the user inserts a todo_list for that user
- Then 1 affected row should be returned
- When the user inserts a todo_item for that list
- Then 1 affected row should be returned
- When the user queries v_active_todo_items
- Then the item should appear with joined list data
- This should work for PostgreSQL, MySQL, MSSQL, and SQLite


### Scenario: Fast test reset with truncate

**Why:** Test suites need fast database resets between tests.

- Given a database with test schema and seed data (10 users, 25 lists, 100 items)
- When the user runs truncate
- Then todo_items should have 0 rows
- And todo_lists should have 0 rows
- And users should have 0 rows
- And explore should still show 3 tables, 3 views, 15 functions
- And inserting a new user should work (identity reset)
- This should complete in under 1 second for test data size
- This should work for PostgreSQL, MySQL, MSSQL, and SQLite


### Scenario: Complete database teardown

**Why:** Some tests need a completely fresh database state.

- Given a database with test schema and seed data
- When the user runs full teardown
- Then explore should show 0 tables, 0 views, 0 functions, 0 types
- And `SELECT * FROM users` should return "table does not exist" error
- And the database should be ready for fresh schema deployment
- This should work for PostgreSQL, MySQL, MSSQL, and SQLite


### Scenario: Explore after partial schema changes

**Why:** Explore must reflect current database state accurately.

- Given a database with test schema
- When the user adds a new column via SQL terminal: `ALTER TABLE users ADD bio TEXT`
- Then explore should show 11 columns for users table
- When the user drops a view via SQL terminal: `DROP VIEW v_active_users`
- Then explore should show 2 views
- When the user creates a new index: `CREATE INDEX idx_test ON users(display_name)`
- Then explore should show the new index on users table


### Scenario: Parallel test execution

**Why:** CI/CD pipelines run tests in parallel.

- Given 4 parallel test processes (one per dialect)
- When each process creates its own test database with unique name
- And each process deploys the test schema
- And each process runs CRUD operations
- And each process truncates data between tests
- Then no process should interfere with another
- And each process should clean up its test database on completion


---


## Test Categories Summary


### Unit Tests (no database required)

- Parser tests (changeset, template, settings)
- Validation tests (config schema, input validation)
- Utility tests (shared module, formatters)
- Type tests (ensure types are correct)


### Integration Tests (requires Docker databases)

- All dialect-specific tests (explore, teardown, db)
- Changeset execution tests
- Runner execution tests
- SQL terminal tests
- Connection handling tests


### CLI Tests (requires terminal simulation)

- Component rendering tests
- Keyboard navigation tests
- Screen flow tests
- Error display tests


---


## Priority Order

1. ✅ **Docker Compose setup** - COMPLETE
2. ✅ **explore module tests** - COMPLETE (38 unit + 4 integration files)
3. ✅ **teardown module tests** - COMPLETE (113 unit + 4 integration files)
4. ✅ **sql-terminal module tests** - COMPLETE (53 unit + 4 integration files)
5. **db module tests** - Enables test automation
6. **changeset integration tests** - Core feature, needs dialect coverage
7. **runner integration tests** - Template execution validation
8. **CLI component tests** - User experience validation


---


## ✅ Future Testing Opportunities (IMPLEMENTED 2025-12-31)

Additional testing opportunities identified during the implementation. Most items have been implemented with 166+ new tests.


### ✅ Module: explore - Edge Cases & New Object Types

**New object types implemented:**
- ✅ Triggers - `listTriggers()`, `getTriggerDetail()` in all 4 dialects
- ✅ Active locks - `listLocks()` in PostgreSQL, MySQL, MSSQL (SQLite returns empty)
- ✅ Active connections - `listConnections()` in PostgreSQL, MySQL, MSSQL (SQLite returns empty)

**Edge cases tested (24 tests in `tests/integration/explore/edge-cases.test.ts`):**
- ✅ Tables with 60+ character names
- ✅ Tables with special characters (spaces, hyphens)
- ✅ Self-referencing foreign keys (`employees.manager_id → employees.id`)
- ✅ Composite primary keys (2-column and 3-column)
- ✅ Composite foreign keys
- ✅ Circular foreign key references
- ⏳ Views referencing other views (nested view dependencies)
- ⏳ Materialized views (PostgreSQL-specific)
- ⏳ Partitioned tables (PostgreSQL, MySQL 8.0+)


### Module: teardown - Error Reporting

Current tests verify successful operations. For failure scenarios, the main value is clear error reporting since manual intervention is required:

- Clear error messages when teardown fails mid-operation (explain what was dropped, what remains)
- Handling of locked tables during truncate/drop (report which table is locked)
- Timeout handling for long-running DROP operations
- Circular foreign key dependencies (detect and report)


### ✅ Module: sql-terminal - Advanced Queries

**Tests added to integration tests (`tests/integration/sql-terminal/*.test.ts`):**
- ✅ Recursive CTEs (WITH RECURSIVE) - all 4 dialects
- ✅ EXPLAIN/EXPLAIN ANALYZE output - PostgreSQL, MySQL, SQLite
- ✅ Explicit transactions (BEGIN/COMMIT/ROLLBACK) - PostgreSQL
- ✅ PRAGMA commands - SQLite
- ⏳ Transaction isolation levels (SERIALIZABLE, REPEATABLE READ)
- ⏳ Savepoints within transactions
- ⏳ Batch statement execution (multiple statements separated by `;`)
- ⏳ Binary data (BLOB/BYTEA) handling in results


### ✅ Module: logger - Reader Component

**Tests created (`tests/core/logger/reader.test.ts` - 18 tests):**
- ✅ Read and parse log files with correct encoding
- ✅ Skip malformed JSON entries gracefully
- ✅ Limit entries to specified count
- ✅ Return entries in reverse chronological order
- ✅ Handle missing/empty files gracefully
- ✅ Validate required log entry fields
- ⏳ Filter logs by level (not implemented in reader)
- ⏳ Filter logs by date range (not implemented in reader)
- ⏳ Handle rotated log files (*.log.1, *.log.2)


### Module: connection - SSL & Edge Cases

The connection module needs more dialect-specific edge case coverage:

- PostgreSQL SSL modes (disable, allow, prefer, require, verify-ca, verify-full)
- MySQL SSL certificate configuration
- MSSQL TrustServerCertificate and encryption settings
- SQLite WAL mode vs journal mode
- Connection pool exhaustion under load
- Connection retry with exponential backoff
- Graceful handling of network interruptions mid-query


### ✅ Module: encryption - Security Tests

**Tests created (`tests/core/state/encryption/crypto.test.ts` - 15 tests):**
- ✅ Round-trip encryption/decryption (short text, long text, JSON)
- ✅ Random IV generation (different ciphertext for same plaintext)
- ✅ AES-256-GCM authentication tag verification
- ✅ Tampered ciphertext detection
- ✅ Tampered auth tag detection
- ✅ Corrupted IV detection
- ✅ Wrong key detection
- ✅ Unsupported algorithm error
- ⏳ Memory safety (clearing sensitive data after use)
- ⏳ Timing attack resistance in comparison operations


### CLI Components - Ink/React Testing

The CLI uses Ink/React and has 24 screens without tests:

- **SearchableList**: Filter behavior, keyboard navigation, selection state
- **ResultTable**: Column alignment, NULL display, truncation, pagination
- **SqlInput**: Multi-line input, paste handling, execution shortcuts
- **Form**: Validation, busy states, error display
- **Toast**: Timing, stacking, dismissal
- **Screen navigation**: History stack, breadcrumbs, back/forward


### Performance & Load Tests

Performance tests to ensure the system scales with realistic workloads:

- Explore performance with 1000+ tables
- SQL terminal performance with 10K+ row results
- History performance with 10K+ entries
- Concurrent connection handling (10+ simultaneous)


### ✅ Security Tests

**Tests created:**
- ✅ Credential sanitization (`tests/core/logger/redact.test.ts` - 45 tests)
  - maskValue, isMaskedField, filterData, addMaskedFields, listenForSecrets
  - Case variations (camelCase, snake_case, UPPERCASE, noorm_ prefix)
  - Recursive object/array filtering
- ✅ File path traversal prevention (`tests/core/template/security.test.ts` - 15 tests)
  - `../../../etc/passwd` attempts rejected
  - Absolute paths outside project rejected
  - Null byte injection rejected
  - Symlink traversal attempts handled
- ⏳ Input validation for user-provided config values


---


## Summary of Future Testing Implementation

**Date:** 2025-12-31

**New Test Files Created:**

| File | Tests | Description |
|------|-------|-------------|
| `tests/core/logger/reader.test.ts` | 18 | Log file reading and parsing |
| `tests/core/logger/redact.test.ts` | 45 | Credential sanitization |
| `tests/core/state/encryption/crypto.test.ts` | 15 | AES-256-GCM encryption |
| `tests/core/template/security.test.ts` | 15 | Path traversal prevention |
| `tests/core/explore/dialects/postgres.test.ts` | 11 | PostgreSQL trigger/lock/connection queries |
| `tests/core/explore/dialects/mysql.test.ts` | 11 | MySQL trigger/lock/connection queries |
| `tests/core/explore/dialects/mssql.test.ts` | 13 | MSSQL trigger/lock/connection queries |
| `tests/core/explore/dialects/sqlite.test.ts` | 14 | SQLite trigger queries |
| `tests/integration/explore/edge-cases.test.ts` | 24 | Edge case integration tests |
| **Total** | **166** | |

**New Features Implemented:**

| Feature | Files Modified |
|---------|----------------|
| Trigger exploration | `src/core/explore/types.ts`, `src/core/explore/operations.ts`, all 4 dialect files |
| Lock exploration | All 4 dialect files |
| Connection exploration | All 4 dialect files |

**New Fixture Files:**

- `tests/fixtures/schema/{dialect}/00X_triggers.sql` - Trigger fixtures for all dialects
- `tests/fixtures/schema/edge-cases/*.sql` - Edge case fixtures (long names, self-ref FK, composite keys, special chars, circular FK)
