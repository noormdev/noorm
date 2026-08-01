CREATE OR REPLACE VIEW open_task AS
SELECT t.user_id, t.created_at, t.task_index, t.title, t.priority,
       p.name AS project_name
FROM task t
JOIN project p ON p.user_id = t.user_id AND p.created_at = t.created_at
WHERE t.done = false;
