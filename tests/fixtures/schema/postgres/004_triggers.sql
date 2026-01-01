-- PostgreSQL Triggers for Test Schema
-- Audit triggers for tracking changes

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(10) NOT NULL,
    row_id TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger function for user changes
CREATE OR REPLACE FUNCTION audit_user_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, row_id, new_data)
        VALUES ('users', TG_OP, NEW.id::TEXT, row_to_json(NEW)::JSONB);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
        VALUES ('users', TG_OP, NEW.id::TEXT, row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, row_id, old_data)
        VALUES ('users', TG_OP, OLD.id::TEXT, row_to_json(OLD)::JSONB);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Audit trigger on users table
CREATE TRIGGER users_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit_user_changes();

-- Trigger function for todo item changes
CREATE OR REPLACE FUNCTION audit_todo_item_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (table_name, operation, row_id, new_data)
        VALUES ('todo_items', TG_OP, NEW.id::TEXT, row_to_json(NEW)::JSONB);
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data)
        VALUES ('todo_items', TG_OP, NEW.id::TEXT, row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB);
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_log (table_name, operation, row_id, old_data)
        VALUES ('todo_items', TG_OP, OLD.id::TEXT, row_to_json(OLD)::JSONB);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Audit trigger on todo_items table
CREATE TRIGGER todo_items_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON todo_items
FOR EACH ROW EXECUTE FUNCTION audit_todo_item_changes();

-- Trigger to automatically set updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Updated_at triggers for all tables
CREATE TRIGGER users_update_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER todo_lists_update_timestamp
BEFORE UPDATE ON todo_lists
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER todo_items_update_timestamp
BEFORE UPDATE ON todo_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
