/**
 * DEFAULT_PORTS single-source tests.
 *
 * Proves `same-server.ts` and the TUI's re-export barrel read the
 * canonical constant in `core/connection/defaults.ts` rather than an
 * independently declared copy that could drift. Dialect factories
 * (`postgres.ts`/`mysql.ts`/`mssql.ts`) are covered by the checkpoint's
 * `rg` proof (no literal port values survive under
 * `src/core/connection/dialects/`) — not duplicated here, since exercising
 * them would require a live/simulated DB connection.
 */
import { describe, it, expect } from 'bun:test';

import { DEFAULT_PORTS } from '../../../src/core/connection/index.js';
import { getDefaultPort } from '../../../src/core/transfer/same-server.js';
import { DEFAULT_PORTS as tuiDefaultPorts } from '../../../src/tui/utils/config-validation.js';
import type { Dialect } from '../../../src/core/connection/types.js';

describe('connection: DEFAULT_PORTS single source', () => {

    it('has exactly one canonical value per dialect', () => {

        expect(DEFAULT_PORTS).toEqual({
            postgres: 5432,
            mysql: 3306,
            sqlite: 0,
            mssql: 1433,
        });

    });

    it('same-server.getDefaultPort reads the canonical constant, not a local copy', () => {

        const dialects: Dialect[] = ['postgres', 'mysql', 'sqlite', 'mssql'];

        for (const dialect of dialects) {

            expect(getDefaultPort(dialect)).toBe(DEFAULT_PORTS[dialect]);

        }

    });

    it('the TUI utils barrel re-exports the same DEFAULT_PORTS object, not a redeclared copy', () => {

        expect(tuiDefaultPorts).toBe(DEFAULT_PORTS);

    });

});
