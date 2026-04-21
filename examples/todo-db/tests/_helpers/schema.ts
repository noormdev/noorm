/**
 * Type contracts for the todo-db example.
 *
 * - `Database` drives Kysely's type-safe query builder
 * - `Tvfs` maps Postgres TVFs (RETURNS TABLE) to `[args, returnRow]` tuples
 * - `Funcs` maps scalar-returning functions to `[args, returnType]`
 *
 * Tuples must include `void` for parameterless calls — matches the SDK's
 * `ExtractArgs<E>` helper.
 */
import type { ColumnType, Generated } from 'kysely';

// -----------------------------------------------------------------------------
// Table row types
// -----------------------------------------------------------------------------

export interface UserTable {
    id: Generated<number>;
    username: string;
    email: string;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
    updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
    deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface CategoryTable {
    id: Generated<number>;
    name: string;
    description: string | null;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface TagTable {
    id: Generated<number>;
    name: string;
    color: ColumnType<string, string | undefined, string>;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface TodoTable {
    user_id: number;
    category_id: number;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
    title: string;
    description: string | null;
    status: ColumnType<string, string | undefined, string>;
    priority: ColumnType<number, number | undefined, number>;
    due_date: ColumnType<string | null, string | null | undefined, string | null>;
    metadata: ColumnType<Record<string, unknown>, Record<string, unknown> | string | undefined, Record<string, unknown> | string>;
    updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface TodoItemTable {
    user_id: number;
    category_id: number;
    todo_created_at: ColumnType<Date, Date | string, Date | string>;
    item_index: number;
    title: string;
    is_completed: ColumnType<boolean, boolean | undefined, boolean>;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
    updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface TodoTagTable {
    user_id: number;
    category_id: number;
    todo_created_at: ColumnType<Date, Date | string, Date | string>;
    tag_id: number;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface TodoItemTagTable {
    user_id: number;
    category_id: number;
    todo_created_at: ColumnType<Date, Date | string, Date | string>;
    item_index: number;
    tag_id: number;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface UserTagTable {
    user_id: number;
    tag_id: number;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CronJobTable {
    id: Generated<number>;
    name: string;
    description: ColumnType<string, string | undefined, string>;
    steps: ColumnType<Array<{ name: string; command: string }>, string | Array<{ name: string; command: string }> | undefined, string | Array<{ name: string; command: string }>>;
    enabled: ColumnType<boolean, boolean | undefined, boolean>;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
    updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CronScheduleTable {
    id: Generated<number>;
    name: string;
    active_start_time: string;
    frequency: string;
    interval: string | null;
    every: string | null;
    every_n: number | null;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
    updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CronJobScheduleTable {
    job_id: number;
    schedule_id: number;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface FeatureFlagTable {
    id: Generated<number>;
    name: string;
    enabled: ColumnType<boolean, boolean | undefined, boolean>;
    config: ColumnType<Record<string, unknown>, Record<string, unknown> | string | undefined, Record<string, unknown> | string>;
    created_at: ColumnType<Date, Date | string | undefined, Date | string>;
    updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

// -----------------------------------------------------------------------------
// View row types (read-only)
// -----------------------------------------------------------------------------

export interface VActiveUsersView {
    id: number;
    username: string;
    email: string;
    created_at: Date;
    updated_at: Date;
}

export interface VTodosWithDetailsView {
    user_id: number;
    category_id: number;
    created_at: Date;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    due_date: string | null;
    updated_at: Date;
    user_username: string;
    user_email: string;
    category_name: string;
    category_description: string | null;
    item_count: string | number;
    completed_item_count: string | number;
    tags: string[] | null;
    metadata: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Database definition for Kysely
// -----------------------------------------------------------------------------

export interface Database {
    user: UserTable;
    category: CategoryTable;
    tag: TagTable;
    todo: TodoTable;
    todo_item: TodoItemTable;
    todo_tag: TodoTagTable;
    todo_item_tag: TodoItemTagTable;
    user_tag: UserTagTable;
    cron_job: CronJobTable;
    cron_schedule: CronScheduleTable;
    cron_job_schedule: CronJobScheduleTable;
    feature_flag: FeatureFlagTable;
    v_active_users: VActiveUsersView;
    v_todos_with_details: VTodosWithDetailsView;
}

// -----------------------------------------------------------------------------
// Function return shapes
// -----------------------------------------------------------------------------

export interface UserRow {
    id: number;
    username: string;
    email: string;
    created_at: Date;
    updated_at: Date;
}

export interface UserWithDeletedRow extends UserRow {
    deleted_at: Date | null;
}

export interface CategoryRow {
    id: number;
    name: string;
    description: string | null;
    created_at: Date;
}

export interface TagRow {
    id: number;
    name: string;
    color: string;
    created_at: Date;
}

export interface BulkCreateTagRow extends TagRow {
    was_inserted: boolean;
}

export interface TodoRow {
    user_id: number;
    category_id: number;
    created_at: Date;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    due_date: string | null;
    metadata: Record<string, unknown>;
    updated_at: Date;
}

export interface TodoItemRow {
    user_id: number;
    category_id: number;
    todo_created_at: Date;
    item_index: number;
    title: string;
    is_completed: boolean;
    created_at: Date;
    updated_at: Date;
}

export interface SearchTodoRow {
    user_id: number;
    category_id: number;
    created_at: Date;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    due_date: string | null;
    metadata: Record<string, unknown>;
    user_username: string;
    category_name: string;
    tags: string[];
}

export interface CompleteTodoRow {
    user_id: number;
    category_id: number;
    created_at: Date;
    status: string;
    items_completed: number;
}

export interface SoftDeleteUserRow {
    id: number;
    username: string;
    deleted_at: Date | null;
    was_already_deleted: boolean;
}

export interface RestoreUserRow {
    id: number;
    username: string;
    deleted_at: Date | null;
}

// -----------------------------------------------------------------------------
// TVF contracts (RETURNS TABLE functions — called via ctx.tvf)
// -----------------------------------------------------------------------------

export interface Tvfs {
    list_users: [
        { p_include_deleted?: boolean; p_limit?: number | null; p_offset?: number | null } | void,
        UserWithDeletedRow,
    ];
    get_user: [{ p_user_id: number }, UserRow];
    create_user: [{ p_username: string; p_email: string }, UserRow];
    update_user: [{ p_user_id: number; p_username: string; p_email: string }, UserRow];
    soft_delete_user: [{ p_user_id: number }, SoftDeleteUserRow];
    restore_user: [{ p_user_id: number }, RestoreUserRow];

    list_categories: [
        { p_limit?: number | null; p_offset?: number | null } | void,
        CategoryRow,
    ];
    get_category: [{ p_category_id: number }, CategoryRow];
    create_category: [{ p_name: string; p_description?: string | null }, CategoryRow];
    update_category: [
        { p_category_id: number; p_name: string; p_description?: string | null },
        CategoryRow,
    ];

    list_tags: [{ p_limit?: number | null; p_offset?: number | null } | void, TagRow];
    get_tag: [{ p_tag_id: number }, TagRow];
    create_tag: [{ p_name: string; p_color?: string }, TagRow];
    update_tag: [{ p_tag_id: number; p_name: string; p_color?: string }, TagRow];
    bulk_create_tags: [{ p_tags: unknown }, BulkCreateTagRow];

    list_todos: [{ p_limit?: number | null; p_offset?: number | null } | void, TodoRow];
    list_todos_by_user: [
        { p_user_id: number; p_limit?: number | null; p_offset?: number | null },
        TodoRow,
    ];
    list_todos_by_category: [
        { p_category_id: number; p_limit?: number | null; p_offset?: number | null },
        TodoRow,
    ];
    get_todo: [
        { p_user_id: number; p_category_id: number; p_created_at: Date | string },
        TodoRow,
    ];
    create_todo: [
        {
            p_user_id: number;
            p_category_id: number;
            p_title: string;
            p_description?: string | null;
            p_priority?: number;
            p_due_date?: string | null;
            p_metadata?: Record<string, unknown> | string;
        },
        TodoRow,
    ];
    update_todo: [
        {
            p_user_id: number;
            p_category_id: number;
            p_created_at: Date | string;
            p_title: string;
            p_description?: string | null;
            p_status?: string;
            p_priority?: number;
            p_due_date?: string | null;
            p_metadata?: Record<string, unknown> | string | null;
        },
        TodoRow,
    ];
    complete_todo: [
        { p_user_id: number; p_category_id: number; p_created_at: Date | string },
        CompleteTodoRow,
    ];
    search_todos: [
        {
            p_keyword?: string | null;
            p_status?: string | null;
            p_limit?: number | null;
            p_offset?: number | null;
        } | void,
        SearchTodoRow,
    ];

    list_todo_items: [{ p_limit?: number | null; p_offset?: number | null } | void, TodoItemRow];
    list_todo_items_by_todo: [
        {
            p_user_id: number;
            p_category_id: number;
            p_todo_created_at: Date | string;
            p_limit?: number | null;
            p_offset?: number | null;
        },
        TodoItemRow,
    ];
    get_todo_item: [
        {
            p_user_id: number;
            p_category_id: number;
            p_todo_created_at: Date | string;
            p_item_index: number;
        },
        TodoItemRow,
    ];
    create_todo_item: [
        {
            p_user_id: number;
            p_category_id: number;
            p_todo_created_at: Date | string;
            p_item_index: number;
            p_title: string;
        },
        TodoItemRow,
    ];
    update_todo_item: [
        {
            p_user_id: number;
            p_category_id: number;
            p_todo_created_at: Date | string;
            p_item_index: number;
            p_title: string;
            p_is_completed: boolean;
        },
        TodoItemRow,
    ];
}

// -----------------------------------------------------------------------------
// Scalar function contracts (RETURNS value — called via ctx.func)
//
// `ctx.func(name, params, column)` issues `SELECT name(...) AS column` and
// returns the first row verbatim — so the return shape is `{ [column]: T }`,
// not the bare scalar. That's why every tuple here types the return as a
// one-key object with the column alias matching the function name.
// -----------------------------------------------------------------------------

export interface Funcs {
    delete_user: [{ p_user_id: number }, { delete_user: boolean }];
    delete_category: [{ p_category_id: number }, { delete_category: boolean }];
    delete_tag: [{ p_tag_id: number }, { delete_tag: boolean }];
    delete_todo: [
        { p_user_id: number; p_category_id: number; p_created_at: Date | string },
        { delete_todo: boolean },
    ];
    delete_todo_item: [
        {
            p_user_id: number;
            p_category_id: number;
            p_todo_created_at: Date | string;
            p_item_index: number;
        },
        { delete_todo_item: boolean },
    ];
}

// No stored procedures used in this schema.
export interface Procs {}
