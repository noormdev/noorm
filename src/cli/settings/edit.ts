/**
 * noorm settings edit — interactive settings editor.
 *
 * Strictly TTY. Loop: pick a section, edit it, return to picker. The
 * session ends when the user picks "Done" or cancels at the top level.
 * Cancelling within a sub-editor returns to the picker — it does not
 * kill the process.
 */
import * as p from '@clack/prompts';
import { attempt } from '@logosdx/utils';
import { defineCommand } from 'citty';

import { getSettingsManager } from '../../core/settings/index.js';
import type {
    BuildConfig,
    LoggingConfig,
    PathConfig,
    Rule,
    Stage,
    StrictConfig,
    TeardownConfig,
} from '../../core/settings/types.js';

type Manager = ReturnType<typeof getSettingsManager>;

type Section =
    | 'paths'
    | 'build'
    | 'strict'
    | 'logging'
    | 'stages'
    | 'rules'
    | 'teardown'
    | 'done';

type LogLevel = NonNullable<LoggingConfig['level']>;

type Dialect = NonNullable<Stage['defaults']>['dialect'];

/**
 * Save a new value for a section, surfacing failures without exiting.
 */
async function safeMutate(label: string, fn: () => Promise<void>): Promise<void> {

    const [, err] = await attempt(fn);

    if (err) {

        p.log.error(`Failed to save ${label}: ${err.message}`);

        return;

    }

    p.log.success(`${label} updated.`);

}

/**
 * Split a comma-separated string into a trimmed, non-empty array.
 */
function parseCsv(input: string): string[] {

    return input.split(',').map((s) => s.trim()).filter(Boolean);

}

/**
 * Edit the paths section (sql, changes). Returns true if user committed,
 * false if they cancelled (in which case we just go back to the picker).
 */
async function editPaths(manager: Manager): Promise<void> {

    const current = manager.getPaths();

    const sql = await p.text({
        message: 'SQL files path',
        initialValue: current.sql ?? './sql',
        validate: (v) => {

            if (v && v.trim()) return undefined;

            return 'Path is required';

        },
    });

    if (p.isCancel(sql)) return;

    const changes = await p.text({
        message: 'Changes path',
        initialValue: current.changes ?? './changes',
        validate: (v) => {

            if (v && v.trim()) return undefined;

            return 'Path is required';

        },
    });

    if (p.isCancel(changes)) return;

    const next: PathConfig = { sql, changes };

    await safeMutate('Paths', () => manager.setPaths(next));

}

/**
 * Edit the build section (include/exclude folder lists).
 */
async function editBuild(manager: Manager): Promise<void> {

    const current = manager.getBuild();

    const includeRaw = await p.text({
        message: 'Build include folders (comma-separated)',
        initialValue: (current.include ?? []).join(', '),
        placeholder: 'e.g. schema, seeds, functions',
    });

    if (p.isCancel(includeRaw)) return;

    const excludeRaw = await p.text({
        message: 'Build exclude folders (comma-separated)',
        initialValue: (current.exclude ?? []).join(', '),
        placeholder: 'e.g. archive, deprecated',
    });

    if (p.isCancel(excludeRaw)) return;

    const next: BuildConfig = {
        include: parseCsv(includeRaw),
        exclude: parseCsv(excludeRaw),
    };

    await safeMutate('Build config', () => manager.setBuild(next));

}

/**
 * Edit the strict mode section.
 */
async function editStrict(manager: Manager): Promise<void> {

    const current = manager.getStrict();

    const enabled = await p.confirm({
        message: 'Enable strict mode?',
        initialValue: current.enabled ?? false,
    });

    if (p.isCancel(enabled)) return;

    let stages: string[] = current.stages ?? [];

    if (enabled) {

        const stagesRaw = await p.text({
            message: 'Required stage names (comma-separated)',
            initialValue: stages.join(', '),
            placeholder: 'e.g. prod, staging',
        });

        if (p.isCancel(stagesRaw)) return;

        stages = parseCsv(stagesRaw);

    }

    const next: StrictConfig = { enabled, stages };

    await safeMutate('Strict mode', () => manager.setStrict(next));

}

/**
 * Edit the logging section.
 */
async function editLogging(manager: Manager): Promise<void> {

    const current = manager.getLogging();

    const enabled = await p.confirm({
        message: 'Enable file logging?',
        initialValue: current.enabled ?? true,
    });

    if (p.isCancel(enabled)) return;

    if (!enabled) {

        await safeMutate('Logging', () => manager.setLogging({ enabled: false }));

        return;

    }

    const level = await p.select<LogLevel>({
        message: 'Log level',
        initialValue: current.level ?? 'info',
        options: [
            { value: 'silent', label: 'Silent' },
            { value: 'error', label: 'Error' },
            { value: 'warn', label: 'Warn' },
            { value: 'info', label: 'Info' },
            { value: 'verbose', label: 'Verbose' },
        ],
    });

    if (p.isCancel(level)) return;

    const file = await p.text({
        message: 'Log file path',
        initialValue: current.file ?? '.noorm/state/noorm.log',
    });

    if (p.isCancel(file)) return;

    const maxSize = await p.text({
        message: 'Max log file size (e.g. 10mb)',
        initialValue: current.maxSize ?? '10mb',
    });

    if (p.isCancel(maxSize)) return;

    const maxFilesRaw = await p.text({
        message: 'Max rotated files to keep',
        initialValue: String(current.maxFiles ?? 5),
        validate: (v) => {

            if (v && /^\d+$/.test(v.trim())) return undefined;

            return 'Must be a number';

        },
    });

    if (p.isCancel(maxFilesRaw)) return;

    const next: LoggingConfig = {
        enabled: true,
        level,
        file,
        maxSize,
        maxFiles: parseInt(maxFilesRaw, 10),
    };

    await safeMutate('Logging', () => manager.setLogging(next));

}

/**
 * Edit the teardown section.
 */
async function editTeardown(manager: Manager): Promise<void> {

    const current = manager.settings.teardown ?? {};

    const preserveRaw = await p.text({
        message: 'Tables to preserve during teardown (comma-separated)',
        initialValue: (current.preserveTables ?? []).join(', '),
        placeholder: 'e.g. AppSettings, UserRoles',
    });

    if (p.isCancel(preserveRaw)) return;

    const postScript = await p.text({
        message: 'Post-teardown SQL script path (leave empty for none)',
        initialValue: current.postScript ?? '',
    });

    if (p.isCancel(postScript)) return;

    const preserveTables = parseCsv(preserveRaw);
    const trimmedScript = postScript.trim();

    const next: TeardownConfig = {
        preserveTables: preserveTables.length > 0 ? preserveTables : undefined,
        postScript: trimmedScript.length > 0 ? trimmedScript : undefined,
    };

    await safeMutate('Teardown', () => manager.setTeardown(next));

}

/**
 * Edit the stages section. Sub-loop: pick add/edit/remove/done.
 */
async function editStages(manager: Manager): Promise<void> {

    while (true) {

        const stages = manager.getStages();
        const stageNames = Object.keys(stages);

        const action = await p.select<'add' | 'edit' | 'remove' | 'back'>({
            message: stageNames.length === 0
                ? 'No stages defined. Add one?'
                : `Stages: ${stageNames.join(', ')}`,
            options: [
                { value: 'add', label: 'Add stage' },
                ...(stageNames.length > 0
                    ? [
                        { value: 'edit' as const, label: 'Edit stage' },
                        { value: 'remove' as const, label: 'Remove stage' },
                    ]
                    : []),
                { value: 'back', label: 'Back' },
            ],
        });

        if (p.isCancel(action) || action === 'back') return;

        if (action === 'add') {

            await stagePrompt(manager, null);

            continue;

        }

        const target = await p.select<string>({
            message: 'Which stage?',
            options: stageNames.map((n) => ({ value: n, label: n })),
        });

        if (p.isCancel(target)) continue;

        if (action === 'edit') {

            await stagePrompt(manager, target);

        }
        else if (action === 'remove') {

            const confirm = await p.confirm({ message: `Remove stage "${target}"?` });

            if (p.isCancel(confirm) || !confirm) continue;

            await safeMutate(`Stage "${target}"`, async () => {

                await manager.removeStage(target);

            });

        }

    }

}

/**
 * Prompt for stage fields. If `name` is null, this is a new stage; the user
 * is asked to name it. Otherwise, edits the existing stage in place.
 */
async function stagePrompt(manager: Manager, name: string | null): Promise<void> {

    let stageName: string;
    const existing: Partial<Stage> = (name ? manager.getStage(name) : null) ?? {};

    if (name === null) {

        const input = await p.text({
            message: 'Stage name',
            placeholder: 'e.g. prod',
            validate: (v) => {

                if (!v || !v.trim()) return 'Stage name is required';
                if (manager.hasStage(v.trim())) return 'Stage already exists';

                return undefined;

            },
        });

        if (p.isCancel(input)) return;

        stageName = input.trim();

    }
    else {

        stageName = name;

    }

    const description = await p.text({
        message: 'Description (optional)',
        initialValue: existing.description ?? '',
    });

    if (p.isCancel(description)) return;

    const locked = await p.confirm({
        message: 'Locked? (configs from this stage cannot be deleted)',
        initialValue: existing.locked ?? false,
    });

    if (p.isCancel(locked)) return;

    const dialect = await p.select<Dialect | 'none'>({
        message: 'Default dialect',
        initialValue: existing.defaults?.dialect ?? 'none',
        options: [
            { value: 'none', label: 'None (let user pick)' },
            { value: 'postgres', label: 'PostgreSQL' },
            { value: 'mysql', label: 'MySQL' },
            { value: 'sqlite', label: 'SQLite' },
            { value: 'mssql', label: 'SQL Server' },
        ],
    });

    if (p.isCancel(dialect)) return;

    const next: Stage = {
        ...existing,
        description: description.trim() || undefined,
        locked,
        defaults: {
            ...(existing.defaults ?? {}),
            dialect: dialect === 'none' ? undefined : dialect,
        },
    };

    await safeMutate(`Stage "${stageName}"`, () => manager.setStage(stageName, next));

}

/**
 * Edit the rules section. Sub-loop: pick add/remove/done.
 */
async function editRules(manager: Manager): Promise<void> {

    while (true) {

        const rules = manager.getRules();

        const action = await p.select<'add' | 'remove' | 'back'>({
            message: rules.length === 0
                ? 'No rules defined. Add one?'
                : `${rules.length} rule(s) defined`,
            options: [
                { value: 'add', label: 'Add rule' },
                ...(rules.length > 0
                    ? [{ value: 'remove' as const, label: 'Remove rule' }]
                    : []),
                { value: 'back', label: 'Back' },
            ],
        });

        if (p.isCancel(action) || action === 'back') return;

        if (action === 'add') {

            await addRulePrompt(manager);

            continue;

        }

        if (action === 'remove') {

            const idx = await p.select<number>({
                message: 'Which rule to remove?',
                options: rules.map((r, i) => ({
                    value: i,
                    label: r.description ?? `rule #${i + 1} (match: ${JSON.stringify(r.match)})`,
                })),
            });

            if (p.isCancel(idx)) continue;

            await safeMutate(`Rule #${idx + 1}`, async () => {

                await manager.removeRule(idx);

            });

        }

    }

}

/**
 * Prompt for a new rule's fields and append it.
 */
async function addRulePrompt(manager: Manager): Promise<void> {

    const description = await p.text({
        message: 'Rule description (optional)',
        placeholder: 'e.g. include test seeds for test configs',
    });

    if (p.isCancel(description)) return;

    const matchProtected = await p.select<'any' | 'true' | 'false'>({
        message: 'Match: protected configs?',
        initialValue: 'any',
        options: [
            { value: 'any', label: 'Any' },
            { value: 'true', label: 'Only protected' },
            { value: 'false', label: 'Only non-protected' },
        ],
    });

    if (p.isCancel(matchProtected)) return;

    const matchTest = await p.select<'any' | 'true' | 'false'>({
        message: 'Match: test configs?',
        initialValue: 'any',
        options: [
            { value: 'any', label: 'Any' },
            { value: 'true', label: 'Only test' },
            { value: 'false', label: 'Only non-test' },
        ],
    });

    if (p.isCancel(matchTest)) return;

    const includeRaw = await p.text({
        message: 'Folders to include when rule matches (comma-separated, optional)',
        placeholder: 'e.g. sql/seeds',
    });

    if (p.isCancel(includeRaw)) return;

    const excludeRaw = await p.text({
        message: 'Folders to exclude when rule matches (comma-separated, optional)',
        placeholder: 'e.g. sql/dangerous',
    });

    if (p.isCancel(excludeRaw)) return;

    const include = parseCsv(includeRaw);
    const exclude = parseCsv(excludeRaw);

    const rule: Rule = {
        description: description.trim() || undefined,
        match: {
            protected: matchProtected === 'any' ? undefined : matchProtected === 'true',
            isTest: matchTest === 'any' ? undefined : matchTest === 'true',
        },
        include: include.length > 0 ? include : undefined,
        exclude: exclude.length > 0 ? exclude : undefined,
    };

    await safeMutate('Rule', () => manager.addRule(rule));

}

const editCommand = defineCommand({
    meta: { name: 'edit', description: 'Interactively edit project settings' },
    args: {},
    async run() {

        if (!process.stdin.isTTY) {

            process.stderr.write('Error: noorm settings edit requires an interactive terminal.\n');
            process.exit(1);

        }

        const projectRoot = process.cwd();
        const settingsManager = getSettingsManager(projectRoot);

        const fileExists = await settingsManager.exists();

        if (!fileExists) {

            process.stderr.write('Error: No settings.yml found. Run: noorm settings init\n');
            process.exit(1);

        }

        const [, loadErr] = await attempt(() => settingsManager.load());

        if (loadErr) {

            process.stderr.write(`Error: Failed to load settings: ${loadErr.message}\n`);
            process.exit(1);

        }

        p.intro('noorm settings edit');

        while (true) {

            const section = await p.select<Section>({
                message: 'Which section to edit?',
                options: [
                    { value: 'paths', label: 'Paths', hint: 'SQL and changes directories' },
                    { value: 'build', label: 'Build', hint: 'Include/exclude folders' },
                    { value: 'strict', label: 'Strict', hint: 'Required stages enforcement' },
                    { value: 'logging', label: 'Logging', hint: 'File logging config' },
                    { value: 'stages', label: 'Stages', hint: 'Preconfigured config templates' },
                    { value: 'rules', label: 'Rules', hint: 'Conditional include/exclude' },
                    { value: 'teardown', label: 'Teardown', hint: 'Reset/teardown behavior' },
                    { value: 'done', label: 'Done', hint: 'Exit editor' },
                ],
            });

            if (p.isCancel(section) || section === 'done') break;

            if (section === 'paths') await editPaths(settingsManager);
            else if (section === 'build') await editBuild(settingsManager);
            else if (section === 'strict') await editStrict(settingsManager);
            else if (section === 'logging') await editLogging(settingsManager);
            else if (section === 'stages') await editStages(settingsManager);
            else if (section === 'rules') await editRules(settingsManager);
            else if (section === 'teardown') await editTeardown(settingsManager);

        }

        p.outro('Settings saved.');
        process.exit(0);

    },
});

(editCommand as typeof editCommand & { examples: string[] }).examples = [
    'noorm settings edit',
];

export default editCommand;
