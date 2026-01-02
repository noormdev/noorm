-- Edge Case: Circular foreign key relationships
-- Tests database handling of tables that reference each other
--
-- NOTE: SQLite doesn't support ALTER TABLE...ADD CONSTRAINT for foreign keys.
-- We work around this by deferring FK constraint creation, which SQLite allows
-- when foreign_keys pragma is disabled during table creation.

-- Temporarily disable FK checks to allow circular references
PRAGMA foreign_keys = OFF;

CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    manager_id INTEGER REFERENCES department_users(id)
);

CREATE TABLE department_users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    department_id INTEGER REFERENCES departments(id)
);

CREATE INDEX idx_department_users_dept ON department_users(department_id);
CREATE INDEX idx_departments_manager ON departments(manager_id);

-- Re-enable FK checks
PRAGMA foreign_keys = ON;
