CREATE TABLE IF NOT EXISTS task (
    user_id     INT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    task_index  INT NOT NULL,
    title       TEXT NOT NULL,
    done        BOOLEAN NOT NULL DEFAULT false,
    priority    INT NOT NULL DEFAULT 3,

    PRIMARY KEY (user_id, created_at, task_index),
    FOREIGN KEY (user_id, created_at) REFERENCES project(user_id, created_at),
    CONSTRAINT task_priority_range CHECK (priority BETWEEN 1 AND 5)
);
