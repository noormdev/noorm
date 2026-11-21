import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { attempt } from '@logosdx/utils';
import { parseDocument } from 'yaml';

import { acquireWriteLock, writeFileAtomicSync } from '../state/persistence.js';
import { ChangeRetiredError } from './types.js';

const RETIRED_FILE = '.noorm/retired.yml';

function isChangeName(value: unknown): value is string {

    return typeof value === 'string' && value.trim().length > 0 && value !== '.' && value !== '..'
        && !value.includes('/') && !value.includes('\\') && !value.includes('\0');

}

async function readRetirementDocument(file: string) {

    const [contents, readErr] = await attempt(() => readFile(file, 'utf8'));

    if (readErr) {

        if ('code' in readErr && readErr.code === 'ENOENT') {

            return { document: parseDocument('[]'), names: new Set<string>() };

        }

        throw readErr;

    }

    const [parsed, parseErr] = await attempt(async () => {

        const document = parseDocument(contents);
        const [issue] = [...document.errors, ...document.warnings];
        if (issue) throw issue;

        const names: unknown = document.toJS();

        return { document, names };

    });

    if (parseErr || !Array.isArray(parsed.names) || !parsed.names.every(isChangeName)) {

        throw new Error(`Invalid retirement file '${file}': expected a YAML list of exact change names`, { cause: parseErr });

    }

    return { document: parsed.document, names: new Set(parsed.names) };

}

/** Read exact retired change names. A missing project file is an empty set. */
export async function readRetiredChanges(projectRoot: string): Promise<Set<string>> {

    return (await readRetirementDocument(path.join(projectRoot, RETIRED_FILE))).names;

}

/** Serialize writers and merge revalidated names into the latest retirement file. */
export async function appendRetiredChanges(
    projectRoot: string,
    revalidate: () => Promise<readonly string[]>,
): Promise<void> {

    const file = path.join(projectRoot, RETIRED_FILE);
    await mkdir(path.dirname(file), { recursive: true });
    const release = await acquireWriteLock(`${file}.lock`);

    try {

        const names = await revalidate();
        if (names.length === 0) return;

        const { document, names: retired } = await readRetirementDocument(file);
        const previousSize = retired.size;

        for (const name of names) {

            if (!isChangeName(name)) throw new Error(`Invalid retired change name: ${name}`);
            if (retired.has(name)) continue;
            document.add(name);
            retired.add(name);

        }

        if (retired.size !== previousSize) {

            writeFileAtomicSync(file, String(document), 0o644);

        }

    }
    finally {

        release();

    }

}

/** Fail before loading or executing SQL for a retired change. */
export async function assertNotRetired(projectRoot: string, name: string, rewindRange?: readonly string[]): Promise<void> {

    const retired = await readRetiredChanges(projectRoot);
    const blocked = retired.has(name) ? name : rewindRange?.find((id) => retired.has(id));
    if (blocked !== undefined) throw new ChangeRetiredError(blocked);

}
