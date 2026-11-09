import { attemptSync } from '@logosdx/utils';
import { McpServer, ProtocolError, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import type { CacheHint, InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';

import { fetchDetail, fetchList, fetchOverview } from '../core/explore/operations.js';
import { gatedExplore } from '../sdk/namespaces/db.js';
import type { DetailCategory } from '../core/explore/operations.js';
import type { ExploreCategory } from '../core/explore/types.js';
import { listVisibleConfigs } from '../core/state/index.js';
import type { Context } from '../sdk/context.js';

const categories: readonly ExploreCategory[] = [
    'tables', 'views', 'procedures', 'functions', 'types', 'indexes',
    'foreignKeys', 'triggers', 'locks', 'connections',
];
const detailCategories: readonly DetailCategory[] = [
    'tables', 'views', 'procedures', 'functions', 'types', 'triggers',
];

function isExploreCategory(value: string): value is ExploreCategory {

    return categories.some((category) => category === value);

}

function isDetailCategory(value: string): value is DetailCategory {

    return detailCategories.some((category) => category === value);

}

function hasControlCharacter(value: string): boolean {

    for (let index = 0; index < value.length; index++) {

        const code = value.charCodeAt(index);
        if (code < 32 || code === 127) return true;

    }

    return false;

}

type ExploreResource =
    | { config: string; kind: 'overview' }
    | { config: string; kind: 'list'; category: ExploreCategory }
    | { config: string; kind: 'detail'; category: DetailCategory; name: string; schema?: string };

/** Parse only the resource shapes we serve, decoding each component exactly once. */
export function parseExploreResource(uri: URL): ExploreResource {

    if (uri.protocol !== 'noorm:' || uri.host !== 'configs' || uri.username || uri.password || uri.hash) {

        throw new ProtocolError(-32602, 'Invalid exploration resource URI');

    }

    const segments = uri.pathname.split('/');
    const decode = (part: string | undefined): string => {

        if (!part) throw new ProtocolError(-32602, 'Invalid exploration resource URI');
        const [value, decodeErr] = attemptSync(() => decodeURIComponent(part));
        if (decodeErr || !value || hasControlCharacter(value)) {

            throw new ProtocolError(-32602, 'Invalid exploration resource URI');

        }

        return value;

    };
    const config = decode(segments[1]);
    if (segments.length === 3 && segments[2] === 'overview' && !uri.search) {

        return { config, kind: 'overview' };

    }
    if (segments[2] !== 'objects') throw new ProtocolError(-32602, 'Invalid exploration resource URI');
    const category = decode(segments[3]);
    if (segments.length === 4 && !uri.search && isExploreCategory(category)) {

        return { config, kind: 'list', category };

    }
    if (segments.length !== 5 || !isDetailCategory(category)) {

        throw new ProtocolError(-32602, 'Invalid exploration resource URI');

    }
    const name = decode(segments[4]);
    const params = [...uri.searchParams];
    if (params.some(([key]) => key !== 'schema') || params.length > 1) {

        throw new ProtocolError(-32602, 'Invalid exploration resource URI');

    }
    const schema = params[0]?.[1];
    if (schema !== undefined && (!schema || hasControlCharacter(schema))) {

        throw new ProtocolError(-32602, 'Invalid exploration resource URI');

    }
    // URLSearchParams tolerates malformed escapes and invalid UTF-8.
    const [, searchErr] = attemptSync(() => decodeURIComponent(uri.search.replace(/\+/g, ' ')));
    if (searchErr) throw new ProtocolError(-32602, 'Invalid exploration resource URI');

    return { config, kind: 'detail', category, name, schema };

}

type WithConfig = <T>(config: string, action: (ctx: Context) => Promise<T>, request: ServerContext, uri: string) => Promise<T | InputRequiredResult>;

/** Register connection-independent discovery and per-read exploration resources. */
export function registerExploreResources(server: McpServer, withConfig: WithConfig, projectRoot = process.cwd()): void {

    const metadata = {
        mimeType: 'application/json',
        cacheHint: { ttlMs: 0, cacheScope: 'private' } satisfies CacheHint,
    };
    const list = async (kind: 'overview' | 'list') => {

        const configs = (await listVisibleConfigs(projectRoot, 'agent'))
            .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

        return {
            resources: configs.flatMap(({ name }) => {

                const root = `noorm://configs/${encodeURIComponent(name)}`;
                if (kind === 'overview') return [{ uri: `${root}/overview`, name: `${name} overview`, mimeType: 'application/json' }];

                return categories.map((category) => ({ uri: `${root}/objects/${category}`, name: `${name} ${category}`, mimeType: 'application/json' }));

            }),
        };

    };
    const read = async (uri: URL, _variables: unknown, request: ServerContext) => {

        const resource = parseExploreResource(uri);

        return withConfig(resource.config, async (ctx) => {

            const value = resource.kind === 'overview'
                ? await ctx.noorm.db[gatedExplore]('overview', (gate) => fetchOverview(ctx.kysely, ctx.dialect, { gate }))
                : resource.kind === 'list'
                    ? await ctx.noorm.db[gatedExplore](
                        resource.category,
                        (gate) => fetchList(ctx.kysely, ctx.dialect, resource.category, { gate }),
                    )
                    : await ctx.noorm.db[gatedExplore](
                        resource.category,
                        (gate) => fetchDetail(ctx.kysely, ctx.dialect, resource.category, resource.name, { schema: resource.schema, gate }),
                    );
            if (resource.kind === 'detail' && value === null) throw new ResourceNotFoundError(uri.toString());

            return { contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(value) }] };

        }, request, uri.toString());

    };
    server.registerResource('noorm-overview', new ResourceTemplate('noorm://configs/{config}/overview', {
        list: () => list('overview'),
    }), { ...metadata, description: 'Database object counts' }, read);
    server.registerResource('noorm-objects', new ResourceTemplate('noorm://configs/{config}/objects/{category}', {
        list: () => list('list'),
    }), { ...metadata, description: 'Database objects by category' }, read);
    server.registerResource('noorm-object-detail-schema', new ResourceTemplate('noorm://configs/{config}/objects/{category}/{name}{?schema}', {
        list: undefined,
    }), { ...metadata, description: 'Database object detail, optionally qualified by schema' }, read);
    // The SDK's URI matcher treats query expressions as required, so register
    // a separate template for the unqualified form.
    server.registerResource('noorm-object-detail', new ResourceTemplate('noorm://configs/{config}/objects/{category}/{name}', {
        list: undefined,
    }), { ...metadata, description: 'Database object detail' }, read);

}
