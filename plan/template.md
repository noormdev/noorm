# Template Engine


## Overview

noorm uses [Eta](https://eta.js.org/) for dynamic SQL generation. Templates can:

- Load external data files (JSON, YAML, CSV, JS/MJS)
- Access secrets and config values
- Include other SQL files
- Use full JavaScript for logic


## Dependencies

```json
{
    "eta": "^3.2.0",
    "yaml": "^2.3.0",
    "csv-parse": "^5.5.0",
    "@logosdx/observer": "^x.x.x",
    "@logosdx/utils": "^x.x.x"
}
```


## File Structure

```
src/core/
├── template/
│   ├── index.ts           # Public exports
│   ├── engine.ts          # Eta wrapper
│   ├── context.ts         # Template context builder
│   ├── loaders/
│   │   ├── index.ts       # Loader registry
│   │   ├── json.ts
│   │   ├── yaml.ts
│   │   ├── csv.ts
│   │   ├── js.ts
│   │   └── sql.ts
│   └── types.ts
```


## Types

```typescript
// src/core/template/types.ts

import { Config } from '../config/types';

export interface TemplateContext {
    // Data loading
    load: (path: string) => Promise<any>;

    // SQL includes
    include: (path: string) => Promise<string>;

    // Environment
    config: Config;
    secrets: Record<string, string>;
    env: Record<string, string>;

    // Utilities
    escape: (value: string) => string;
    quote: (value: string) => string;
    json: (value: any) => string;

    // Helpers
    now: () => string;
    uuid: () => string;
}

export interface RenderOptions {
    /** Base path for relative imports */
    basePath: string;

    /** Config object */
    config: Config;

    /** Decrypted secrets */
    secrets: Record<string, string>;

    /** Additional context variables */
    variables?: Record<string, any>;
}

export type LoaderFn = (absolutePath: string) => Promise<any>;
```


## Data Loaders

### Loader Registry

```typescript
// src/core/template/loaders/index.ts

import { LoaderFn } from '../types';
import { loadJson } from './json';
import { loadYaml } from './yaml';
import { loadCsv } from './csv';
import { loadJs } from './js';
import { loadSql } from './sql';

const loaders: Record<string, LoaderFn> = {
    '.json': loadJson,
    '.yaml': loadYaml,
    '.yml': loadYaml,
    '.csv': loadCsv,
    '.js': loadJs,
    '.mjs': loadJs,
    '.sql': loadSql,
};

export function getLoader(extension: string): LoaderFn | null {
    return loaders[extension.toLowerCase()] ?? null;
}

export function getSupportedExtensions(): string[] {
    return Object.keys(loaders);
}
```

### JSON Loader

```typescript
// src/core/template/loaders/json.ts

import { readFile } from 'fs/promises';

export async function loadJson(path: string): Promise<any> {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content);
}
```

### YAML Loader

```typescript
// src/core/template/loaders/yaml.ts

import { readFile } from 'fs/promises';
import { parse } from 'yaml';

export async function loadYaml(path: string): Promise<any> {
    const content = await readFile(path, 'utf8');
    return parse(content);
}
```

### CSV Loader

```typescript
// src/core/template/loaders/csv.ts

import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';

export async function loadCsv(path: string): Promise<Record<string, string>[]> {
    const content = await readFile(path, 'utf8');

    return parse(content, {
        columns: true,           // Use first row as headers
        skip_empty_lines: true,
        trim: true,
    });
}
```

### JavaScript Loader

```typescript
// src/core/template/loaders/js.ts

import { pathToFileURL } from 'url';

export async function loadJs(path: string): Promise<any> {
    // Use dynamic import for ES modules
    const url = pathToFileURL(path).href;

    // Clear from cache if previously loaded (for dev/testing)
    delete require.cache[path];

    const module = await import(url);

    // Return default export or entire module
    return module.default ?? module;
}
```

### SQL Loader

```typescript
// src/core/template/loaders/sql.ts

import { readFile } from 'fs/promises';

export async function loadSql(path: string): Promise<string> {
    return readFile(path, 'utf8');
}
```


## Template Context

```typescript
// src/core/template/context.ts

import { resolve, dirname, extname } from 'path';
import { randomUUID } from 'crypto';
import { attempt } from '@logosdx/utils';
import { TemplateContext, RenderOptions } from './types';
import { getLoader, getSupportedExtensions } from './loaders';
import { observer } from '../observer';

type LoadFormat = 'json' | 'yaml' | 'csv' | 'js' | 'sql';

function extToFormat(ext: string): LoadFormat {
    const map: Record<string, LoadFormat> = {
        '.json': 'json',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.csv': 'csv',
        '.js': 'js',
        '.mjs': 'js',
        '.sql': 'sql',
    };
    return map[ext.toLowerCase()] ?? 'json';
}

export function createContext(options: RenderOptions): TemplateContext {
    const { basePath, config, secrets, variables = {} } = options;

    // Cache loaded files
    const loadCache = new Map<string, any>();

    const context: TemplateContext = {
        // ─────────────────────────────────────────────────────────────
        // Data Loading
        // ─────────────────────────────────────────────────────────────

        async load(relativePath: string): Promise<any> {
            const absolutePath = resolve(basePath, relativePath);

            // Check cache
            if (loadCache.has(absolutePath)) {
                return loadCache.get(absolutePath);
            }

            const ext = extname(absolutePath);
            const loader = getLoader(ext);

            if (!loader) {
                throw new Error(
                    `Unsupported file type: ${ext}. ` +
                    `Supported: ${getSupportedExtensions().join(', ')}`
                );
            }

            const [data, err] = await attempt(() => loader(absolutePath));

            if (err) {
                observer.emit('error', { source: 'template', error: err, context: { filepath: absolutePath } });
                throw err;
            }

            observer.emit('template:load', {
                filepath: absolutePath,
                format: extToFormat(ext)
            });

            loadCache.set(absolutePath, data);
            return data;
        },

        async include(relativePath: string): Promise<string> {
            const absolutePath = resolve(basePath, relativePath);
            const loader = getLoader('.sql');

            const [content, err] = await attempt(() => loader!(absolutePath));
            if (err) {
                observer.emit('error', { source: 'template', error: err, context: { filepath: absolutePath } });
                throw err;
            }

            observer.emit('template:load', { filepath: absolutePath, format: 'sql' });
            return content!;
        },

        // ─────────────────────────────────────────────────────────────
        // Environment
        // ─────────────────────────────────────────────────────────────

        config,
        secrets,
        env: { ...process.env } as Record<string, string>,

        // ─────────────────────────────────────────────────────────────
        // Utilities
        // ─────────────────────────────────────────────────────────────

        escape(value: string): string {
            if (value === null || value === undefined) return 'NULL';

            // Basic SQL escaping (single quotes)
            return value.replace(/'/g, "''");
        },

        quote(value: string): string {
            if (value === null || value === undefined) return 'NULL';
            return `'${context.escape(value)}'`;
        },

        json(value: any): string {
            return JSON.stringify(value);
        },

        // ─────────────────────────────────────────────────────────────
        // Helpers
        // ─────────────────────────────────────────────────────────────

        now(): string {
            return new Date().toISOString();
        },

        uuid(): string {
            return randomUUID();
        },

        // Spread any additional variables
        ...variables,
    };

    return context;
}
```


## Template Engine

```typescript
// src/core/template/engine.ts

import { Eta } from 'eta';
import { readFile } from 'fs/promises';
import { resolve, dirname, extname } from 'path';
import { existsSync } from 'fs';
import { attempt } from '@logosdx/utils';
import { createContext } from './context';
import { RenderOptions } from './types';
import { observer } from '../observer';

export class TemplateEngine {
    private eta: Eta;

    constructor() {
        this.eta = new Eta({
            // Use <% %> tags (default)
            tags: ['<%', '%>'],

            // Allow async functions
            async: true,

            // Don't auto-escape (we handle SQL escaping manually)
            autoEscape: false,

            // Custom function name for accessing context
            varName: 'it',

            // Enable caching
            cache: true,
        });
    }

    /**
     * Render a template file.
     */
    async renderFile(filePath: string, options: RenderOptions): Promise<string> {
        const absolutePath = resolve(filePath);
        const start = performance.now();

        const [content, readErr] = await attempt(() => readFile(absolutePath, 'utf8'));
        if (readErr) {
            observer.emit('error', { source: 'template', error: readErr, context: { filepath: absolutePath } });
            throw readErr;
        }

        const result = await this.render(content!, {
            ...options,
            basePath: dirname(absolutePath),
        });

        observer.emit('template:render', {
            filepath: absolutePath,
            durationMs: performance.now() - start
        });

        return result;
    }

    /**
     * Render a template string.
     */
    async render(template: string, options: RenderOptions): Promise<string> {
        const context = createContext(options);

        const [result, err] = await attempt(() => this.eta.renderStringAsync(template, context));

        if (err) {
            observer.emit('error', { source: 'template', error: err });
            throw new TemplateError(
                `Template rendering failed: ${err.message}`,
                template,
                err
            );
        }

        return result!;
    }

    /**
     * Check if a file is a template (has .eta extension).
     */
    isTemplate(filePath: string): boolean {
        return filePath.endsWith('.eta');
    }

    /**
     * Process a file - render if template, return raw content otherwise.
     */
    async processFile(filePath: string, options: RenderOptions): Promise<string> {
        if (this.isTemplate(filePath)) {
            return this.renderFile(filePath, options);
        }

        return readFile(filePath, 'utf8');
    }
}

export class TemplateError extends Error {
    constructor(
        message: string,
        public template: string,
        public cause: Error
    ) {
        super(message);
        this.name = 'TemplateError';
    }
}

// Singleton
let engine: TemplateEngine | null = null;

export function getTemplateEngine(): TemplateEngine {
    if (!engine) {
        engine = new TemplateEngine();
    }
    return engine;
}
```


## Public Exports

```typescript
// src/core/template/index.ts

export { TemplateEngine, getTemplateEngine, TemplateError } from './engine';
export { createContext } from './context';
export * from './types';
export { getSupportedExtensions } from './loaders';
```


## Template Syntax

### Basic Output

```sql
-- schema/001_create_users.sql.eta
CREATE TABLE <%= it.config.name %>_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL
);
```

### Conditionals

```sql
-- schema/002_create_indexes.sql.eta
CREATE INDEX idx_users_email ON users(email);

<% if (it.config.connection.dialect === 'postgres') { %>
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
<% } %>
```

### Loops

```sql
-- schema/003_seed_roles.sql.eta
<% const roles = ['admin', 'user', 'guest']; %>

INSERT INTO roles (name, created_at) VALUES
<% roles.forEach((role, i) => { %>
    ('<%= role %>', '<%= it.now() %>')<%= i < roles.length - 1 ? ',' : '' %>
<% }); %>;
```

### Loading External Data

```sql
-- schema/004_seed_users.sql.eta
<% const users = await it.load('seeds/users.json'); %>

INSERT INTO users (email, name, role_id) VALUES
<% users.forEach((user, i) => { %>
    (<%= it.quote(user.email) %>,
     <%= it.quote(user.name) %>,
     (SELECT id FROM roles WHERE name = <%= it.quote(user.role) %>))<%= i < users.length - 1 ? ',' : '' %>
<% }); %>;
```

### Using Secrets

```sql
-- schema/005_create_api_config.sql.eta
INSERT INTO config (key, value) VALUES
    ('api_key', '<%= it.secrets.API_KEY %>'),
    ('api_url', '<%= it.env.API_URL || 'https://api.example.com' %>');
```

### Including Other SQL

```sql
-- schema/010_setup.sql.eta
-- Include common functions
<%= await it.include('lib/uuid_function.sql') %>

-- Include triggers
<%= await it.include('lib/audit_triggers.sql') %>
```

### CSV Data

```csv
# seeds/countries.csv
code,name,population
US,United States,331000000
CA,Canada,38000000
MX,Mexico,128000000
```

```sql
-- schema/006_seed_countries.sql.eta
<% const countries = await it.load('seeds/countries.csv'); %>

INSERT INTO countries (code, name, population) VALUES
<% countries.forEach((c, i) => { %>
    (<%= it.quote(c.code) %>, <%= it.quote(c.name) %>, <%= c.population %>)<%= i < countries.length - 1 ? ',' : '' %>
<% }); %>;
```

### Dynamic JS Data

```javascript
// seeds/fake-users.mjs
import { faker } from '@faker-js/faker';

export default Array.from({ length: 50 }, () => ({
    email: faker.internet.email(),
    name: faker.person.fullName(),
    created_at: faker.date.past().toISOString(),
}));
```

```sql
-- schema/007_seed_fake_users.sql.eta
<% const users = await it.load('seeds/fake-users.mjs'); %>

INSERT INTO users (email, name, created_at) VALUES
<% users.forEach((u, i) => { %>
    (<%= it.quote(u.email) %>, <%= it.quote(u.name) %>, '<%= u.created_at %>')<%= i < users.length - 1 ? ',' : '' %>
<% }); %>;
```

### YAML Config

```yaml
# config/tables.yml
users:
  columns:
    - name: id
      type: SERIAL PRIMARY KEY
    - name: email
      type: VARCHAR(255) NOT NULL
    - name: created_at
      type: TIMESTAMP DEFAULT NOW()

posts:
  columns:
    - name: id
      type: SERIAL PRIMARY KEY
    - name: user_id
      type: INTEGER REFERENCES users(id)
    - name: title
      type: VARCHAR(500) NOT NULL
```

```sql
-- schema/001_create_tables.sql.eta
<% const schema = await it.load('config/tables.yml'); %>

<% for (const [tableName, table] of Object.entries(schema)) { %>
CREATE TABLE <%= tableName %> (
<% table.columns.forEach((col, i) => { %>
    <%= col.name %> <%= col.type %><%= i < table.columns.length - 1 ? ',' : '' %>
<% }); %>
);

<% } %>
```


## Usage Examples

### Basic Rendering

```typescript
import { getTemplateEngine } from './core/template';

const engine = getTemplateEngine();

const sql = await engine.renderFile('schema/001_create_users.sql.eta', {
    basePath: process.cwd(),
    config: activeConfig,
    secrets: await state.getAllSecrets(activeConfig.name),
});

console.log(sql);
```

### With Additional Variables

```typescript
const sql = await engine.render(
    `INSERT INTO logs (message) VALUES (<%= it.quote(it.message) %>);`,
    {
        basePath: process.cwd(),
        config: activeConfig,
        secrets: {},
        variables: {
            message: 'Hello from template!',
        },
    }
);
```

### Processing Files (Template or Raw)

```typescript
const engine = getTemplateEngine();

// Automatically detects .eta extension
const sql = await engine.processFile('schema/001_users.sql.eta', options);
// Renders template

const raw = await engine.processFile('schema/002_data.sql', options);
// Returns raw content
```


## File Naming Convention

| Extension | Type | Processing |
|-----------|------|------------|
| `.sql` | Raw SQL | Executed as-is |
| `.sql.eta` | Template | Rendered then executed |

Examples:
- `001_create_users.sql` - Static SQL
- `002_seed_users.sql.eta` - Dynamic SQL with data loading
- `003_create_indexes.sql` - Static SQL


## Error Handling

```typescript
import { TemplateError } from './core/template';

try {
    const sql = await engine.renderFile(path, options);
} catch (error) {
    if (error instanceof TemplateError) {
        console.error('Template error:', error.message);
        console.error('In template:', error.template.slice(0, 100));
        console.error('Caused by:', error.cause);
    }
    throw error;
}
```


## Testing

```typescript
import { TemplateEngine } from './core/template';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TemplateEngine', () => {
    let tempDir: string;
    let engine: TemplateEngine;

    const mockConfig = {
        name: 'test',
        type: 'local' as const,
        isTest: true,
        protected: false,
        connection: { dialect: 'postgres' as const, database: 'test' },
        paths: { schema: './schema', changesets: './changesets' },
    };

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'noorm-template-'));
        engine = new TemplateEngine();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true });
    });

    it('should render basic template', async () => {
        const result = await engine.render(
            'SELECT * FROM <%= it.config.name %>_users;',
            { basePath: tempDir, config: mockConfig, secrets: {} }
        );

        expect(result).toBe('SELECT * FROM test_users;');
    });

    it('should load JSON data', async () => {
        writeFileSync(
            join(tempDir, 'data.json'),
            JSON.stringify([{ name: 'Alice' }, { name: 'Bob' }])
        );

        const result = await engine.render(
            `<% const users = await it.load('data.json'); %><%= users.map(u => u.name).join(', ') %>`,
            { basePath: tempDir, config: mockConfig, secrets: {} }
        );

        expect(result).toBe('Alice, Bob');
    });

    it('should load CSV data', async () => {
        writeFileSync(join(tempDir, 'data.csv'), 'name,age\nAlice,30\nBob,25');

        const result = await engine.render(
            `<% const rows = await it.load('data.csv'); %><%= rows.length %>`,
            { basePath: tempDir, config: mockConfig, secrets: {} }
        );

        expect(result).toBe('2');
    });

    it('should escape SQL values', async () => {
        const result = await engine.render(
            `<%= it.quote("O'Reilly") %>`,
            { basePath: tempDir, config: mockConfig, secrets: {} }
        );

        expect(result).toBe("'O''Reilly'");
    });

    it('should access secrets', async () => {
        const result = await engine.render(
            `<%= it.secrets.API_KEY %>`,
            { basePath: tempDir, config: mockConfig, secrets: { API_KEY: 'secret123' } }
        );

        expect(result).toBe('secret123');
    });

    it('should include other SQL files', async () => {
        writeFileSync(join(tempDir, 'fragment.sql'), 'SELECT 1;');

        const result = await engine.render(
            `<%= await it.include('fragment.sql') %>`,
            { basePath: tempDir, config: mockConfig, secrets: {} }
        );

        expect(result).toBe('SELECT 1;');
    });

    it('should detect template files', () => {
        expect(engine.isTemplate('file.sql.eta')).toBe(true);
        expect(engine.isTemplate('file.sql')).toBe(false);
    });

    it('should handle template errors gracefully', async () => {
        await expect(
            engine.render(
                '<%= undefinedVariable %>',
                { basePath: tempDir, config: mockConfig, secrets: {} }
            )
        ).rejects.toThrow(TemplateError);
    });
});
```


## Security Considerations

1. **SQL Injection** - Always use `it.quote()` or `it.escape()` for user-provided values
2. **Secret Exposure** - Secrets are available in templates; don't log rendered SQL
3. **JS Execution** - `.js`/`.mjs` loaders execute arbitrary code; only load trusted files
4. **Path Traversal** - `load()` and `include()` resolve relative to basePath; validate paths


## Best Practices

1. **Keep templates simple** - Complex logic belongs in `.mjs` data files
2. **Use typed data files** - YAML/JSON for static data, JS for dynamic
3. **Escape all dynamic values** - Even if you trust the source
4. **Cache loaded data** - The engine caches automatically per render
5. **Use includes for reusable SQL** - Functions, triggers, common patterns
