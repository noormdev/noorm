#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';

const root = await mkdtemp(join(tmpdir(), 'noorm-mcp-artifact-'));
const entry = resolve(process.argv[2] ?? 'dist/cli/index.js');
const child = spawn(process.execPath, [entry, '--cwd', root, 'mcp', 'serve'], {
    cwd: root,
    env: { ...process.env, HOME: root },
    stdio: ['pipe', 'pipe', 'inherit'],
});
const exited = once(child, 'exit');
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;

lines.on('line', (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response);
});

async function request(method, params = {}) {
    const id = ++nextId;
    let timeout;
    try {
        const response = await new Promise((resolveResponse, reject) => {
            pending.set(id, resolveResponse);
            timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 15000);
            child.stdin.write(`${JSON.stringify({
                jsonrpc: '2.0', id, method,
                params: {
                    ...params,
                    _meta: {
                        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                        'io.modelcontextprotocol/clientCapabilities': {},
                        'io.modelcontextprotocol/clientInfo': { name: 'artifact-smoke', version: '1' },
                    },
                },
            })}\n`);
        });
        assert.equal(response.error, undefined, JSON.stringify(response.error));
        return response.result;
    }
    finally {
        clearTimeout(timeout);
        pending.delete(id);
    }
}

try {
    await request('server/discover');
    const { tools } = await request('tools/list');
    assert(tools.some(({ name }) => name === 'sql'));
    assert(!tools.some(({ name }) => name === 'run_noorm_cmd'));
    const { prompts } = await request('prompts/list');
    const args = {
        config: 'artifact-smoke', change: '001_example', path: 'sql/example.sql',
        question: 'Which tables exist?', task: 'Build the database',
        provider: 'GitHub Actions', target: 'test',
    };
    for (const { name, arguments: argumentsSchema = [] } of prompts) {
        const promptArgs = Object.fromEntries(argumentsSchema
            .filter(({ name: key }) => Object.hasOwn(args, key))
            .map(({ name: key }) => [key, args[key]]));
        const result = await request('prompts/get', { name, arguments: promptArgs });
        assert(result.messages.some(({ content }) => content.type === 'text' && content.text.includes(args.config)),
            `${name} did not render its embedded guidance`);
    }
    assert(prompts.some(({ name }) => name === 'noorm_ci'));
    console.log(`MCP artifact smoke passed: ${tools.length} tools, ${prompts.length} rendered prompts.`);
    child.stdin.end();
    const [code] = await exited;
    assert.equal(code, 0);
}
finally {
    if (child.exitCode === null) child.kill();
    lines.close();
    await rm(root, { recursive: true, force: true });
}
