-- Edge Case: Self-referencing foreign key
-- Tests database handling of tables that reference themselves

-- Employee hierarchy with self-referencing manager relationship
CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    manager_id INTEGER REFERENCES employees(id),
    department VARCHAR(100),
    hire_date DATE
);

CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_employees_department ON employees(department);

-- Category tree with self-referencing parent relationship
CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    parent_category_id INTEGER REFERENCES categories(id),
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_categories_parent ON categories(parent_category_id);
