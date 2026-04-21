-- =============================================================================
-- Bulk Create Tags (Table-Valued Parameter style)
-- Accepts an array of tag_input composite-type rows and upserts them in a
-- single round-trip. Postgres has no true TVP; the array-of-composite pattern
-- is the canonical equivalent — expand with UNNEST and treat like a VALUES
-- clause. Existing names are left alone; only color is refreshed.
-- =============================================================================

CREATE OR REPLACE FUNCTION bulk_create_tags(
    p_tags tag_input[]
)
RETURNS TABLE (
    id INTEGER,
    name VARCHAR(50),
    color VARCHAR(7),
    created_at TIMESTAMP WITH TIME ZONE,
    was_inserted BOOLEAN
)
LANGUAGE plpgsql
AS $$
-- RETURNS TABLE (name, color, ...) declares name/color as PL/pgSQL output
-- variables, so every unqualified `name`/`color` in the body collides with a
-- table column. #variable_conflict use_column tells the planner "prefer the
-- column when ambiguous" — the cleanest way to reuse natural column names as
-- output-parameter names.
#variable_conflict use_column
BEGIN
    IF p_tags IS NULL OR array_length(p_tags, 1) IS NULL THEN
        RAISE EXCEPTION 'bulk_create_tags: input array is empty'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH inputs AS (
        SELECT
            (t).name AS name,
            COALESCE(NULLIF((t).color, ''), '#808080') AS color
        FROM UNNEST(p_tags) AS t
        WHERE (t).name IS NOT NULL
          AND LENGTH(TRIM((t).name)) > 0
    ),
    upsert AS (
        INSERT INTO tag (name, color)
        SELECT name, color FROM inputs
        ON CONFLICT (name) DO UPDATE
            SET color = EXCLUDED.color
        RETURNING
            tag.id,
            tag.name,
            tag.color,
            tag.created_at,
            (xmax = 0) AS was_inserted
    )
    SELECT * FROM upsert
    ORDER BY name;
END;
$$;
