/**
 * Static import-graph check for lazy CLI startup.
 *
 * Walks only top-level ImportDeclaration/ExportDeclaration nodes via
 * the TypeScript AST -- deliberately not a regex over source text -- so
 * dynamic import() call expressions (which live inside statement
 * bodies, e.g. inside run()) are structurally excluded from the walk
 * rather than pattern-matched around. Proves headless invocations never
 * statically reach Ink, React, or the TUI.
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

const REPO_ROOT = process.cwd();

/**
 * Collects the module specifiers of a file's top-level static imports:
 * import ... from 'x' and re-export forms (export {a} from 'x',
 * export * from 'x'). Local export function ... / export const ...
 * declarations have no moduleSpecifier and are skipped.
 */
function extractStaticSpecifiers(filePath: string): string[] {

    const source = readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];

    for (const statement of sourceFile.statements) {

        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {

            specifiers.push(statement.moduleSpecifier.text);

        }

        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {

            specifiers.push(statement.moduleSpecifier.text);

        }

    }

    return specifiers;

}

/**
 * Resolves a relative import specifier against the importing file's
 * directory to its source file, mirroring this repo's NodeNext
 * convention (source imports carry a .js extension that maps to a
 * .ts/.tsx file at authoring time).
 */
function resolveRelative(fromFile: string, specifier: string): string {

    const withoutExt = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
    const base = resolve(dirname(fromFile), withoutExt);

    if (existsSync(base + '.ts')) return base + '.ts';
    if (existsSync(base + '.tsx')) return base + '.tsx';

    throw new Error('Cannot resolve "' + specifier + '" from ' + fromFile + ': neither ' + base + '.ts nor ' + base + '.tsx exists');

}

/**
 * BFS over the static import graph reachable from rootFile. Only
 * relative specifiers (./..) are followed; bare package specifiers
 * are recorded but not recursed into -- there's no need to walk into
 * node_modules to prove a package is (or isn't) reachable.
 */
function staticReachable(rootFile: string): { files: Set<string>; bareSpecifiers: Set<string> } {

    const files = new Set<string>();
    const bareSpecifiers = new Set<string>();
    const queue = [rootFile];

    while (queue.length > 0) {

        const current = queue.shift()!;

        if (files.has(current)) continue;
        files.add(current);

        for (const specifier of extractStaticSpecifiers(current)) {

            if (specifier.startsWith('.')) {

                queue.push(resolveRelative(current, specifier));

            }
            else if (!specifier.startsWith('/') && !specifier.startsWith('node:')) {

                bareSpecifiers.add(specifier);

            }

        }

    }

    return { files, bareSpecifiers };

}

describe('cli: lazy startup - static import graph', () => {

    it('headless entry point never statically reaches ink, react, or the tui', () => {

        const { files, bareSpecifiers } = staticReachable(join(REPO_ROOT, 'src/cli/index.ts'));

        expect(bareSpecifiers.has('ink')).toBe(false);
        expect(bareSpecifiers.has('react')).toBe(false);

        const tuiRoot = join(REPO_ROOT, 'src/tui') + '/';
        const reachesTui = [...files].some((file) => file.startsWith(tuiRoot));

        expect(reachesTui).toBe(false);

    });

    it('ui.ts does not statically import ink or react', () => {

        const specifiers = extractStaticSpecifiers(join(REPO_ROOT, 'src/cli/ui.ts'));

        expect(specifiers).not.toContain('ink');
        expect(specifiers).not.toContain('react');

    });

    it('sql/repl.ts does not statically import ink or react', () => {

        const specifiers = extractStaticSpecifiers(join(REPO_ROOT, 'src/cli/sql/repl.ts'));

        expect(specifiers).not.toContain('ink');
        expect(specifiers).not.toContain('react');

    });

});
