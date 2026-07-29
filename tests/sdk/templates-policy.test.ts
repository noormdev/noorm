/**
 * SDK templates.render() access gate.
 *
 * `templates.render` is the SDK analogue of `run inspect`, except it
 * returns fully rendered SQL — every resolved secret in plaintext — and it
 * executes whatever `$helpers` and referenced side-car scripts the template
 * pulls in. It was the only namespace method in the run/template slice with
 * no policy check at all, so a `viewer` config denied every `run:*`
 * permission could still read secrets and run code through it.
 *
 * The gate must fire before any state or vault work, which is what lets
 * this test drive the namespace with no loaded StateManager.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { attempt } from '@logosdx/utils';

import { TemplatesNamespace } from '../../src/sdk/namespaces/templates.js';
import { ProtectedConfigError } from '../../src/sdk/guards.js';

import type { ContextState } from '../../src/sdk/state.js';
import type { Config } from '../../src/core/config/types.js';
import type { Role } from '../../src/core/policy/index.js';

function makeState(projectRoot: string, userRole: Role): ContextState {

    const config: Config = {
        name: 'dev',
        type: 'local',
        isTest: false,
        access: { user: userRole, mcp: userRole },
        connection: { dialect: 'postgres', database: 'testdb' },
    };

    return {
        connection: null,
        config,
        settings: {},
        identity: { name: 'tester', source: 'system' },
        options: {},
        projectRoot,
        changeManager: null,
    } as unknown as ContextState;

}

describe('sdk: templates.render policy gate', () => {

    it('should refuse to render for a viewer role', async () => {

        const projectRoot = await mkdtemp(join(tmpdir(), 'noorm-tmpl-policy-'));
        await writeFile(join(projectRoot, 'x.sql.tmpl'), 'SELECT 1;', 'utf-8');

        const templates = new TemplatesNamespace(makeState(projectRoot, 'viewer'));

        const [result, err] = await attempt(() => templates.render('x.sql.tmpl'));

        expect(result).toBeFalsy();
        expect(err).toBeInstanceOf(ProtectedConfigError);

        await rm(projectRoot, { recursive: true, force: true });

    });

});
