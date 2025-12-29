/**
 * Template engine module.
 *
 * Provides Eta-based SQL templating with:
 * - Auto-loading data files (JSON5, YAML, CSV, JS/TS)
 * - Inherited helpers via $helpers.ts files
 * - Custom syntax (`{% %}` for code, `{%~ %}` for output)
 * - Built-in SQL helpers (quote, escape, include, etc.)
 *
 * @example
 * ```typescript
 * import { processFile, isTemplate } from './core/template'
 *
 * // Process a template file
 * const result = await processFile('/path/to/file.sql.tmpl', {
 *     projectRoot: '/project',
 *     config: activeConfig,
 *     secrets: { API_KEY: '...' },
 * })
 *
 * console.log(result.sql)
 * ```
 *
 * @module
 */

// Engine - main entry points
export { processFile, processFiles, renderTemplate, isTemplate, eta } from './engine.js';

// Context builder
export { buildContext } from './context.js';

// Helper loader
export { loadHelpers, findHelperFiles } from './helpers.js';

// Data loaders
export {
    loadDataFile,
    hasLoader,
    getLoader,
    getSupportedExtensions,
    loadJson5,
    loadYaml,
    loadCsv,
    loadJs,
    loadSql,
} from './loaders/index.js';

// Utilities
export { toContextKey, sqlEscape, sqlQuote, generateUuid, isoNow } from './utils.js';

// Types
export type {
    TemplateContext,
    BuiltInHelpers,
    RenderOptions,
    ProcessResult,
    LoaderResult,
    Loader,
    LoaderRegistry,
} from './types.js';

export {
    DATA_EXTENSIONS,
    TEMPLATE_EXTENSION,
    HELPER_FILENAME,
    HELPER_EXTENSIONS,
} from './types.js';
