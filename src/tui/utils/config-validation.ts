/**
 * Config form validation utilities.
 *
 * Shared validators for config name, port, and connection
 * config building used by ConfigAdd, ConfigEdit, and ConfigCopy screens.
 *
 * @example
 * ```typescript
 * const error = validateConfigName('dev', existingNames);
 * const config = buildConnectionConfig(values, dialect);
 * ```
 */
import { attemptSync } from '@logosdx/utils';

import type { FormField, FormValues, SelectOption } from '../components/index.js';
import { SSL_FIELD_PAIRS, type ConnectionConfig, type Dialect } from '../../core/connection/types.js';
import type { Config } from '../../core/config/types.js';
import type { ConfigAccess } from '../../core/policy/index.js';
import { BUILTIN_ROLES, guarded } from '../../core/policy/index.js';
import { DEFAULT_PORTS } from '../../core/connection/index.js';
import { ConfigNameSchema, PortSchema } from '../../core/config/schema.js';
import { combineSsl } from '../../core/config/ssl-combine.js';
import { SettingsProvider, effectiveConfig } from '../../core/config/resolver.js';
import type { SettingsManager } from '../../core/settings/manager.js';

export { DEFAULT_PORTS };

/**
 * Validates a config name for format and optional uniqueness.
 *
 * Used in form field validators and standalone validation callbacks.
 *
 * @example
 * ```typescript
 * // In form field:
 * validate: (value) => validateConfigName(String(value), existingNames)
 *
 * // In standalone callback:
 * const error = validateConfigName(name, existingNames);
 * ```
 */
export function validateConfigName(
    value: string,
    existingNames?: string[],
): string | undefined {

    const result = ConfigNameSchema.safeParse(value);

    if (!result.success) {

        return result.error.issues[0]?.message ?? 'Invalid config name';

    }

    if (existingNames?.includes(value)) {

        return 'Config name already exists';

    }

    return undefined;

}

/**
 * Validates a port number string.
 *
 * Returns undefined for empty/missing values (port is optional).
 *
 * @example
 * ```typescript
 * validate: (value) => validatePort(String(value))
 * ```
 */
export function validatePort(value: string | undefined): string | undefined {

    if (!value) return undefined;

    const port = parseInt(value, 10);

    if (isNaN(port)) {

        return 'Port must be 1-65535';

    }

    const result = PortSchema.safeParse(port);

    if (!result.success) {

        return result.error.issues[0]?.message ?? 'Invalid port';

    }

    return undefined;

}

type Ssl = ConnectionConfig['ssl'];
type SslObject = Exclude<NonNullable<Ssl>, boolean>;

const SSL_FORM_KEYS = { caFile: 'sslCaFile', certFile: 'sslCertFile', keyFile: 'sslKeyFile' } as const;

const SSL_FILE_FIELDS = SSL_FIELD_PAIRS.map(([inline, file]) => ({ form: SSL_FORM_KEYS[file], inline, file }));

const FILE_FIELD_LABELS = {
    sslCaFile: { label: 'CA File', placeholder: './certs/ca.pem' },
    sslCertFile: { label: 'Client Cert File', placeholder: '(optional)' },
    sslKeyFile: { label: 'Client Key File', placeholder: '(optional)' },
};

const sslObject = (connection?: ConnectionConfig): SslObject | undefined =>
    (typeof connection?.ssl === 'object' ? connection.ssl : undefined);

/** True when `ssl` encrypts without validating the certificate: the one test the forms, the list tag and the import preview share.
 * @example skipsVerification({ rejectUnauthorized: false }) // true */
export const skipsVerification = (ssl: Ssl): boolean => typeof ssl === 'object' && ssl.rejectUnauthorized === false;

const trimmed = (value: unknown): string => String(value ?? '').trim();

/**
 * The six SSL fields of the config forms. The edit form passes the stored
 * connection and its effective one, so a stage's `ssl` shows as the state in
 * effect; the add form passes neither and shows no stage state. An inline-PEM
 * field shows empty: the form edits paths.
 *
 * @example
 * ```typescript
 * const fields = [...baseFields, ...buildSslFields(config.connection, effective.connection)];
 * ```
 */
export function buildSslFields(stored?: ConnectionConfig, effective = stored): FormField[] {

    const storedSsl = sslObject(stored);
    const effectiveSsl = sslObject(effective);

    const fileFields = SSL_FILE_FIELDS.map(({ form, inline, file }): FormField => {

        const stagePath = storedSsl?.[file] ? undefined : effectiveSsl?.[file];

        return {
            key: form,
            label: FILE_FIELD_LABELS[form].label,
            type: 'text',
            placeholder: storedSsl?.[inline]
                ? '(inline certificate stored)'
                : stagePath ? `(stage: ${stagePath})` : FILE_FIELD_LABELS[form].placeholder,
            defaultValue: storedSsl?.[file] ?? '',
        };

    });

    return [
        {
            key: 'useSsl',
            label: 'Use SSL',
            type: 'checkbox',
            defaultValue: Boolean(effective?.ssl),
        },
        {
            key: 'verifyCertificate',
            label: 'Verify Certificate',
            type: 'checkbox',
            defaultValue: !skipsVerification(effective?.ssl),
        },
        ...fileFields,
        {
            key: 'tlsServerName',
            label: 'TLS Server Name',
            type: 'text',
            placeholder: '(optional)',
            defaultValue: stored?.tlsServerName ?? '',
        },
    ];

}

// An untouched form keeps the stored `ssl`, absent included: storing what the form shows would copy the stage's state.
function buildSsl(values: FormValues, stored?: ConnectionConfig, effective = stored): Ssl {

    const storedSsl = sslObject(stored);
    const useSsl = Boolean(values['useSsl']);
    const verify = Boolean(values['verifyCertificate']);

    const pathChanged = SSL_FILE_FIELDS.some(({ form, file }) => trimmed(values[form]) !== trimmed(storedSsl?.[file]));
    const initiallyVerified = !skipsVerification(effective?.ssl);
    const verifyChanged = useSsl && verify !== initiallyVerified;

    if (useSsl === Boolean(effective?.ssl) && !pathChanged && !verifyChanged) return stored?.ssl;
    if (!useSsl) return false;

    const ssl: SslObject = { ...storedSsl };

    for (const { form, inline, file } of SSL_FILE_FIELDS) {

        const path = trimmed(values[form]);

        if (path) {

            ssl[file] = path;
            delete ssl[inline];

        }
        else {

            delete ssl[file];

        }

    }

    // Stated even when a stage supplied the false: `rejectUnauthorized` is never inherited by a layer that sets `ssl`.
    if (!verify) ssl.rejectUnauthorized = false;
    else if (ssl.rejectUnauthorized === false) delete ssl.rejectUnauthorized;

    return Object.keys(ssl).length > 0 ? ssl : true;

}

/**
 * Builds a connection config object from form values.
 *
 * Starts from `existing` so fields the form does not show (pool, inline PEM,
 * timeouts, keepalive) survive an edit. `effective` is the connection the form
 * was built from; an SSL field that still holds its initial value leaves the
 * stored `ssl` and `tlsServerName` as they were, and an empty port field keeps
 * the stored port, absent included, so a stage port still applies; only the add
 * form falls back to the dialect default. For SQLite, host, port, user
 * and password are dropped, as is a stored `filename` (the Database field names
 * the file), and the SSL fields are not mapped from the form.
 *
 * @example
 * ```typescript
 * // ConfigAddScreen:
 * const config = buildConnectionConfig(values, dialect);
 *
 * // ConfigEditScreen:
 * const config = buildConnectionConfig(values, dialect, stored.connection, effective.connection);
 * ```
 */
export function buildConnectionConfig(
    values: FormValues,
    dialect: Dialect,
    existing?: ConnectionConfig,
    effective = existing,
): ConnectionConfig {

    const isSqlite = dialect === 'sqlite';

    const connection: ConnectionConfig = {
        ...existing,
        dialect,
        host: isSqlite ? undefined : String(values['host'] || 'localhost'),
        port: isSqlite
            ? undefined
            : values['port']
                ? parseInt(String(values['port']), 10)
                : existing ? existing.port : DEFAULT_PORTS[dialect],
        database: String(values['database']),
        user: isSqlite ? undefined : values['user'] ? String(values['user']) : undefined,
        password: isSqlite
            ? undefined
            : values['password']
                ? String(values['password'])
                : existing?.password,
    };

    if (isSqlite) {

        delete connection.filename;

        return connection;

    }

    const ssl = buildSsl(values, existing, effective);
    const tlsServerName = trimmed(values['tlsServerName']);

    if (ssl !== undefined) connection.ssl = ssl;

    if (tlsServerName === trimmed(existing?.tlsServerName)) return connection;

    if (tlsServerName) {

        connection.tlsServerName = tlsServerName;

    }
    else {

        delete connection.tlsServerName;

    }

    return connection;

}

/**
 * Returns a message when the save would store a connection whose SSL settings
 * contradict each other once the stage's `ssl` applies beneath it, else undefined.
 * Screens call it at submit because field validators see only their own value.
 *
 * @example
 * ```typescript
 * const error = validateSslForm(values, dialect, stage?.defaults?.ssl, stored.connection, effective.connection);
 * ```
 */
export function validateSslForm(
    values: FormValues,
    dialect: Dialect,
    stageSsl?: Ssl,
    existing?: ConnectionConfig,
    effective = existing,
): string | undefined {

    if (dialect === 'sqlite') return undefined;

    const saved = buildConnectionConfig(values, dialect, existing, effective);
    const ssl = combineSsl(stageSsl, saved.ssl);
    const storedSsl = sslObject(existing);

    const pathEntered = SSL_FILE_FIELDS.some(({ form, file }) => {

        const path = trimmed(values[form]);

        return path !== '' && path !== trimmed(storedSsl?.[file]);

    });

    if (!ssl && pathEntered) return 'A certificate file needs Use SSL. Check Use SSL or clear the path.';

    if (dialect === 'mssql' || !saved.tlsServerName) return undefined;

    if (!ssl) return 'TLS server name needs Use SSL on PostgreSQL and MySQL. Check Use SSL or clear the name.';

    if (skipsVerification(ssl)) {

        return 'TLS server name needs Verify Certificate on PostgreSQL and MySQL. Check Verify Certificate or clear the name.';

    }

    return undefined;

}

type TlsState = 'off' | 'verified' | 'unverified';

const tlsState = (on: boolean, verified: boolean): TlsState => {

    if (!on) return 'off';

    return verified ? 'verified' : 'unverified';

};

/** A stage links to a config by name, so a rename could save another TLS state than the form shows; this is the `ssl` that keeps it.
 * @example const pinned = sslPinnedByRename(values, dialect, settingsManager?.getStage(newName)?.defaults?.ssl, stored, effective) */
export function sslPinnedByRename(
    values: FormValues,
    dialect: Dialect,
    newStageSsl?: Ssl,
    existing?: ConnectionConfig,
    effective = existing,
): Ssl | undefined {

    if (dialect === 'sqlite') return undefined;

    const saved = buildConnectionConfig(values, dialect, existing, effective).ssl;
    const result = combineSsl(newStageSsl, saved);
    const shown = tlsState(Boolean(values['useSsl']), Boolean(values['verifyCertificate']));

    if (shown === tlsState(Boolean(result), !skipsVerification(result))) return undefined;
    if (shown === 'off') return false;

    const { rejectUnauthorized: _dropped, ...certificates } = typeof saved === 'object' ? saved : {};

    if (shown === 'unverified') return { ...certificates, rejectUnauthorized: false };

    return Object.keys(certificates).length > 0 ? certificates : true;

}

/** The form connection over the defaults of the stage named in the form, as the connection test opens it.
 * @example const [tested, stageErr] = connectionOverStage(String(values['name']), connection, settingsManager) */
export function connectionOverStage(name: string, connection: ConnectionConfig, settingsManager: SettingsManager | null) {

    return attemptSync(() => {

        if (!settingsManager) throw new Error('Settings are not available');

        return effectiveConfig({ name, connection }, new SettingsProvider(settingsManager), false).connection;

    });

}

/** Values for role options are encoded so a role named "off" is selectable. */
const AGENT_OFF_VALUE = 'off';

export function getRoleOptions(roles?: Record<string, unknown>): {
    user: SelectOption[];
    agent: SelectOption[];
} {

    const names = [...new Set([...BUILTIN_ROLES, ...Object.keys(roles ?? {})])];
    const user = names.map((name) => ({ label: name, value: name }));

    return {
        user,
        agent: [
            { label: 'Off (hidden from agents)', value: AGENT_OFF_VALUE },
            ...names.map((name) => ({ label: name, value: `role:${name}` })),
        ],
    };

}

/**
 * Builds a `ConfigAccess` from the role fields shared by ConfigAdd/ConfigEdit.
 * Role names are validated against project settings when the config is resolved.
 *
 * @example
 * ```typescript
 * buildAccessFromValues({ userRole: 'operator', agentRole: 'off' });
 * // { user: 'operator', agent: false }
 * ```
 */
export function buildAccessFromValues(values: FormValues): ConfigAccess {

    const userRoleValue = String(values['userRole'] ?? 'viewer');
    const agentRoleValue = String(values['agentRole'] ?? AGENT_OFF_VALUE);

    return {
        user: userRoleValue,
        agent: agentRoleValue === AGENT_OFF_VALUE
            ? false
            : agentRoleValue.startsWith('role:')
                ? agentRoleValue.slice(5)
                : agentRoleValue,
    };

}

/**
 * `guarded()` narrowed for the TUI's `Config`. Display-only (styling cues),
 * same role as `guarded()` itself — never an enforcement input.
 *
 * @example
 * ```tsx
 * borderColor={isConfigGuarded(activeConfig) ? 'yellow' : undefined}
 * ```
 */
export function isConfigGuarded(config: Config): boolean {

    return guarded(config);

}
