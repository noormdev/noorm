/**
 * Cron template helpers (Postgres variant).
 *
 * Keeps the YAML human-readable while the adjacent crons.sql.tmpl gets a
 * normalized, pre-validated payload. All exports end up on the $ context
 * (see noorm's helper cascade) so templates can call `$.validateCronConfig`,
 * `$.encodeSteps`, etc. directly.
 */

const FREQUENCIES = [
    'Once',
    'Daily',
    'Weekly',
    'Monthly',
    'MonthlyRelative',
    'OnStart',
    'OnIdle',
] as const;

const WEEKDAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
] as const;

const SUBDAY_UNITS = ['Seconds', 'Minutes', 'Hours'] as const;

type Step = { name: string; command: string };

type Job = {
    Description: string;
    Steps: Step[];
};

type Schedule = {
    time: string;
    frequency: typeof FREQUENCIES[number];
    interval?: string | number;
    every?: typeof SUBDAY_UNITS[number];
    every_n?: number;
    jobs: string[];
};

type CronConfig = {
    Jobs: Record<string, Job>;
    Schedules: Record<string, Schedule>;
};

const fail = (msg: string): never => {
    throw new Error(`cron.yml: ${msg}`);
};

/**
 * Asserts the parsed cron YAML is well-formed. Runs before any SQL is emitted
 * so a bad template fails fast during `noorm run build` instead of producing
 * half-valid SQL.
 */
export const validateCronConfig = (config: CronConfig): void => {

    if (!config || typeof config !== 'object') fail('root must be an object');
    if (!config.Jobs || typeof config.Jobs !== 'object') fail('Jobs section is required');
    if (!config.Schedules || typeof config.Schedules !== 'object') fail('Schedules section is required');

    for (const [jobName, job] of Object.entries(config.Jobs)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(jobName)) fail(`invalid job name "${jobName}"`);
        if (!job.Description) fail(`job "${jobName}" missing Description`);
        if (!Array.isArray(job.Steps) || job.Steps.length === 0) fail(`job "${jobName}" must have at least one Step`);
        for (const step of job.Steps) {
            if (!step.name || !step.command) fail(`job "${jobName}" has a step missing name/command`);
        }
    }

    const jobNames = new Set(Object.keys(config.Jobs));

    for (const [schedName, sched] of Object.entries(config.Schedules)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(schedName)) fail(`invalid schedule name "${schedName}"`);
        if (!/^[0-9]{6}$/.test(sched.time)) fail(`schedule "${schedName}" time must be 'HHMMSS'`);
        if (!FREQUENCIES.includes(sched.frequency)) fail(`schedule "${schedName}" has invalid frequency`);

        if (sched.frequency === 'Weekly' && !WEEKDAYS.includes(sched.interval as typeof WEEKDAYS[number])) {
            fail(`Weekly schedule "${schedName}" needs interval = a weekday name`);
        }
        if (sched.frequency === 'Monthly' && typeof sched.interval !== 'number') {
            fail(`Monthly schedule "${schedName}" needs interval = day-of-month (1..31)`);
        }
        if (sched.every && !SUBDAY_UNITS.includes(sched.every)) {
            fail(`schedule "${schedName}" has invalid 'every'`);
        }
        if (sched.every && (!sched.every_n || sched.every_n < 1)) {
            fail(`schedule "${schedName}" with 'every' needs every_n >= 1`);
        }
        if (!Array.isArray(sched.jobs)) fail(`schedule "${schedName}" jobs must be an array`);

        for (const j of sched.jobs) {
            if (!jobNames.has(j)) fail(`schedule "${schedName}" references unknown job "${j}"`);
        }
    }
};

/**
 * Normalizes a schedule's interval into the VARCHAR column value. Weekly gets
 * the weekday name; Monthly gets the day number as text; everything else is NULL.
 */
export const scheduleInterval = (sched: Schedule): string | null => {

    if (sched.frequency === 'Weekly') return String(sched.interval);
    if (sched.frequency === 'Monthly' || sched.frequency === 'MonthlyRelative') return String(sched.interval);
    return null;
};

/**
 * Serializes a job's Steps array to a JSONB literal safe for interpolation.
 * Uses JSON.stringify then SQL-escapes single quotes so command bodies can
 * freely contain any characters.
 */
export const encodeSteps = (steps: Step[]): string => {

    const json = JSON.stringify(steps);
    const escaped = json.replace(/'/g, "''");
    return `'${escaped}'::jsonb`;
};
