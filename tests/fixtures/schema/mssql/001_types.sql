-- MSSQL Custom Types for Test Schema
-- These user-defined types are used to test explore module type detection

-- Email address type with format constraint
CREATE TYPE EmailAddress FROM VARCHAR(255) NOT NULL;

-- Username type with length constraint
CREATE TYPE Username FROM VARCHAR(100) NOT NULL;

-- Hex color code type (e.g., #FF5733)
CREATE TYPE HexColor FROM CHAR(7) NULL;

-- Priority level type (0-3)
CREATE TYPE Priority FROM TINYINT NOT NULL;

-- Soft delete timestamp type
CREATE TYPE SoftDeleteDate FROM DATETIMEOFFSET NULL;
