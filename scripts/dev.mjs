#!/usr/bin/env npx zx

import { watch } from 'node:fs';
import ts from 'typescript';
import { $ } from 'zx/core';

function bundlePrompts() {
    // Synchronous: TypeScript's emitter and this bundler must never write the
    // prompt module concurrently. Keep watching after an invalid template edit.
    const result = $({ sync: true, nothrow: true, preferLocal: true, stdio: 'inherit' })`tsup --config tsup.prompts.config.ts`;
    if (result.exitCode === 0) console.log('MCP prompt assets ready.');
}

const host = ts.createWatchCompilerHost('tsconfig.json', {}, ts.sys);
const afterProgramCreate = host.afterProgramCreate;
host.afterProgramCreate = (program) => {
    afterProgramCreate?.(program);
    bundlePrompts();
};

const compiler = ts.createWatchProgram(host);
let templateTimer;
const onTemplateChange = () => {
    clearTimeout(templateTimer);
    templateTimer = setTimeout(bundlePrompts, 100);
};
const templates = watch('src/mcp/prompts', onTemplateChange);
const config = watch('.', (_event, filename) => {
    if (filename === 'tsup.prompts.config.ts') onTemplateChange();
});

function shutdown() {
    clearTimeout(templateTimer);
    templates.close();
    config.close();
    compiler.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
