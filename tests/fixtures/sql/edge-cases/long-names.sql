-- Edge Case: Long identifier names
-- Tests database handling of maximum-length identifiers

-- PostgreSQL max identifier: 63 characters (NAMEDATALEN - 1)
-- MySQL max identifier: 64 characters
-- MSSQL max identifier: 128 characters
-- SQLite max identifier: effectively unlimited, but 63 is reasonable

-- Table with 63-character name (PostgreSQL limit)
CREATE TABLE this_is_a_very_long_table_name_that_tests_identifier_limits (
    id INTEGER PRIMARY KEY,
    this_is_a_very_long_column_name_that_tests_identifier_lim VARCHAR(255),
    short_col VARCHAR(100)
);

-- Index with long name
CREATE INDEX idx_very_long_table_name_tests_identifier_limits_short_col
ON this_is_a_very_long_table_name_that_tests_identifier_limits(short_col);
