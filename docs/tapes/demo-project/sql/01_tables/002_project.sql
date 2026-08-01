CREATE TABLE IF NOT EXISTS project (
    user_id     INT NOT NULL REFERENCES app_user(user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    name        TEXT NOT NULL,

    -- Inherited key: a project is identified by its owner plus its creation
    -- instant. No surrogate project_id, so every child row carries the owner.
    PRIMARY KEY (user_id, created_at)
);
