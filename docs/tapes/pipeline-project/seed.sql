CREATE SCHEMA recording;
CREATE DOMAIN recording.period_key AS text NOT NULL CHECK (VALUE ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
CREATE DOMAIN recording.invoice_no AS integer NOT NULL CHECK (VALUE > 0);
CREATE DOMAIN recording.amount AS numeric(12,2) NOT NULL CHECK (VALUE >= 0);
CREATE DOMAIN recording.item_count AS integer NOT NULL CHECK (VALUE >= 0);
CREATE DOMAIN recording.flag AS boolean NOT NULL;
CREATE TABLE recording.invoice (
    invoice_no recording.invoice_no PRIMARY KEY,
    period recording.period_key,
    amount recording.amount,
    paid recording.flag
);
CREATE TABLE recording.period_cache (
    period recording.period_key PRIMARY KEY,
    invoice_count recording.item_count,
    total recording.amount,
    unpaid_count recording.item_count
);
CREATE TABLE recording.period_close (
    period recording.period_key PRIMARY KEY REFERENCES recording.period_cache(period),
    total recording.amount
);
INSERT INTO recording.invoice VALUES
    (1, '2026-10', 120, true), (2, '2026-10', 80, true),
    (3, '2026-11', 150, true), (4, '2026-11', 50, false),
    (5, '2026-12', 300, true), (6, '2026-12', 20, false);
