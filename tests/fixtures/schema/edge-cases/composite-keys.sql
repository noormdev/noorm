-- Edge Case: Composite primary and foreign keys
-- Tests database handling of multi-column keys

-- Composite primary key (order_id, product_id)
CREATE TABLE order_items (
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    PRIMARY KEY (order_id, product_id)
);

-- Foreign key referencing composite primary key
CREATE TABLE order_item_details (
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    detail_type VARCHAR(50) NOT NULL,
    detail_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id, product_id, detail_type),
    FOREIGN KEY (order_id, product_id) REFERENCES order_items(order_id, product_id)
);

-- Composite unique constraint
CREATE TABLE user_permissions (
    user_id INTEGER NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id INTEGER NOT NULL,
    permission_level VARCHAR(20) NOT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, resource_type, resource_id)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX idx_user_permissions_resource ON user_permissions(resource_type, resource_id);
