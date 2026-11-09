import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, win32 } from 'node:path';
import { attempt, attemptSync } from '@logosdx/utils';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { classOnlyCause, invalidDefinition, pipelineNotFound, type PipelineCodedError } from './errors.js';
import { isWithinRoot } from '../template/utils.js';
import { isPipelineScalar, matchesPipelineInputType } from './input.js';
import { isPipelineSlug } from './parse.js';

import type {
    LoadPipelineDefinitionOptions,
    PipelineDefinition,
    PipelineInputDeclaration,
    PipelineJsonValue,
} from './types.js';

const InputSchema = z.object({
    type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array']),
    description: z.string().refine((value) => value.trim().length > 0),
    required: z.boolean().default(false),
    default: z.unknown().optional(),
    choices: z.array(z.unknown()).optional(),
}).strict();

// PostgreSQL text cannot store NUL; UTF-8 encoding would replace lone surrogates.
const invalidMetadataText = /[\uD800-\uDFFF]/u;

const StepSchema = z.object({
    id: z.string().max(255).refine(
        (value) => value.trim().length > 0 && !value.includes('\0') && !invalidMetadataText.test(value),
    ),
    sql: z.string().min(1).max(500).refine((value) => !value.includes('\0') && !invalidMetadataText.test(value)),
    needs: z.array(z.string().min(1)).optional(),
}).strict();

const ManifestSchema = z.object({
    description: z.string().optional(),
    transaction: z.enum(['pipeline', 'step', 'none']).default('step'),
    concurrency: z.number().int().positive().default(4),
    singleRun: z.boolean().default(false),
    inputs: z.record(z.string(), InputSchema).default({}),
    steps: z.array(StepSchema).min(1),
}).strict();

const reservedFlags = [
    'slug', 'input', 'config', 'cwd', 'json', 'yes', 'force', 'dry-run',
    'help', 'version', 'limit', 'c', 'f', 'y', 'h', 'v',
];
const unsafeKeys: Record<string, boolean> = { ['__proto__']: true, prototype: true, constructor: true };

/** The kebab-case CLI flag that carries an input, so the CLI and the definition rules agree on collisions. */
export function pipelineInputFlagName(name: string): string {

    return name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

}


function validateInputs(inputs: z.infer<typeof ManifestSchema>['inputs']): Record<string, PipelineInputDeclaration> {

    const flags = new Set(reservedFlags);
    const result: Record<string, PipelineInputDeclaration> = {};
    for (const [name, declaration] of Object.entries(inputs)) {

        const flag = pipelineInputFlagName(name);
        if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || Object.hasOwn(unsafeKeys, name) || flags.has(flag)) {

            throw invalidDefinition('input-name', `Invalid or conflicting pipeline input name: ${name}`);

        }
        flags.add(flag);
        const { type, description, required, choices } = declaration;
        const hasDefault = Object.hasOwn(declaration, 'default');
        const defaultValue = declaration.default;
        const defaults: { default?: PipelineJsonValue } = {};
        if (hasDefault) {

            if (!matchesPipelineInputType(defaultValue, type)) {

                throw invalidDefinition('input-default', `Invalid default for pipeline input: ${name}`);

            }
            defaults.default = defaultValue;

        }
        if (choices !== undefined) {

            if (type === 'object' || type === 'array' || !choices.every(isPipelineScalar)
                || choices.some((choice) => !matchesPipelineInputType(choice, type))) {

                throw invalidDefinition('input-choices', `Invalid choices for pipeline input: ${name}`);

            }
            if (hasDefault && !choices.some((choice) => choice === defaultValue)) {

                throw invalidDefinition('input-default-choice', `Default is not a choice for pipeline input: ${name}`);

            }

        }
        result[name] = {
            type, description, required,
            ...defaults,
            ...(choices !== undefined ? { choices } : {}),
        };

    }

    return result;

}

function safeRelative(path: string): boolean {

    return path.length > 0 && !isAbsolute(path) && !win32.isAbsolute(path) &&
        !path.includes('\\') && !path.includes(':') && !path.includes('\0') && !path.split('/').includes('..');

}

async function existingContained(
    base: string,
    path: string,
    kind: 'file' | 'directory',
    notFound: () => PipelineCodedError = () => invalidDefinition(kind === 'file' ? 'missing-file' : 'missing-directory', `Pipeline ${kind} not found`),
): Promise<string> {

    const [target, unresolved] = await attempt(() => realpath(path));
    if (unresolved || !target) {

        if (unresolved instanceof Error && 'code' in unresolved && unresolved.code === 'ENOENT') throw notFound();
        throw invalidDefinition('unreadable-path', `Pipeline ${kind} is not readable`, classOnlyCause(unresolved));

    }
    if (!isWithinRoot(target, base)) throw invalidDefinition('path-escape', `Pipeline ${kind} escapes its containing directory`);
    const [info, statError] = await attempt(() => stat(target));
    if (statError || !info) throw invalidDefinition('unreadable-path', `Pipeline ${kind} is not readable`, classOnlyCause(statError));
    if (kind === 'file' ? !info.isFile() : !info.isDirectory()) {

        throw invalidDefinition('path-kind', `Pipeline path is not a ${kind}`);

    }

    return target;

}

/** Load and validate a pipeline definition without executing SQL. */
export async function loadPipelineDefinition(options: LoadPipelineDefinitionOptions): Promise<PipelineDefinition> {

    const { slug, projectRoot, pipelinesPath } = options;
    if (!isPipelineSlug(slug)) {

        throw invalidDefinition('slug', `Invalid pipeline slug: ${slug}`);

    }
    if (!safeRelative(pipelinesPath)) throw invalidDefinition('pipelines-path', 'Invalid pipelines path');

    const root = await realpath(projectRoot);
    const pipelinesRoot = await existingContained(root, resolve(root, pipelinesPath), 'directory');
    const folder = await existingContained(pipelinesRoot, resolve(pipelinesRoot, slug), 'directory', pipelineNotFound);
    const manifestPath = await existingContained(folder, resolve(folder, 'pipeline.yml'), 'file');
    const [content, readError] = await attempt(() => readFile(manifestPath, 'utf8'));
    if (readError || content === undefined) throw invalidDefinition('unreadable-path', 'Pipeline file is not readable', classOnlyCause(readError));
    const [parsed, yamlError] = attemptSync(() => parseYaml(content));
    if (yamlError) throw invalidDefinition('yaml', 'Invalid YAML in pipeline manifest', classOnlyCause(yamlError));
    const result = ManifestSchema.safeParse(parsed);
    if (!result.success) throw invalidDefinition('manifest-schema', `Invalid pipeline manifest: ${result.error.issues.map((issue) => issue.path.join('.') || 'manifest').join(', ')}`);
    const manifest = result.data;
    const inputs = validateInputs(manifest.inputs);
    const graph = manifest.steps.some((step) => step.needs !== undefined);
    if (graph && manifest.steps.some((step) => step.needs === undefined)) throw invalidDefinition('mixed-dependencies', 'Pipeline steps cannot mix linear and graph dependencies');

    const ids = new Map<string, number>();
    manifest.steps.forEach((step, index) => {

        if (ids.has(step.id)) throw invalidDefinition('duplicate-step', `Duplicate pipeline step: ${step.id}`);
        ids.set(step.id, index + 1);

    });

    const steps = await Promise.all(manifest.steps.map(async (step, index) => {

        if (!safeRelative(step.sql) || !/\.sql(?:\.tmpl)?$/.test(step.sql)) throw invalidDefinition('step-sql-path', `Invalid SQL path for pipeline step: ${step.id}`);
        const filepath = await existingContained(folder, resolve(folder, step.sql), 'file');
        const seen = new Set<string>();
        const needs = step.needs ? step.needs.map((id) => {

            const dependency = ids.get(id);
            if (!dependency || id === step.id || seen.has(id)) throw invalidDefinition('step-dependency', `Invalid dependency for pipeline step: ${step.id}`);
            seen.add(id);

            return dependency;

        }) : index === 0 ? [] : [index];

        return { stepNo: index + 1, id: step.id, sql: step.sql, filepath, needs };

    }));

    const remaining = steps.map((step) => step.needs.length);
    const dependents = steps.map(() => [] as number[]);
    for (const step of steps) {

        for (const dependency of step.needs) dependents[dependency - 1]!.push(step.stepNo - 1);

    }
    const ready = remaining.flatMap((count, index) => count === 0 ? [index] : []);
    for (let i = 0; i < ready.length; i++) {

        for (const dependent of dependents[ready[i]!]!) {

            remaining[dependent]!--;
            if (remaining[dependent] === 0) ready.push(dependent);

        }

    }
    if (ready.length !== steps.length) throw invalidDefinition('dependency-cycle', 'Pipeline dependencies contain a cycle');

    return {
        slug, folder, manifestPath,
        manifestChecksum: createHash('sha256').update(content, 'utf8').digest('hex'),
        ...(manifest.description !== undefined ? { description: manifest.description } : {}),
        transaction: manifest.transaction,
        concurrency: manifest.concurrency,
        singleRun: manifest.singleRun,
        mode: graph ? 'graph' : 'linear',
        inputs, steps,
    };

}
