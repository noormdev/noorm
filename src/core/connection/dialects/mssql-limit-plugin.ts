/**
 * Kysely plugin that converts LIMIT to TOP for MSSQL.
 *
 * Kysely 0.28.x's MssqlQueryCompiler does not override visitLimit(),
 * so .limit(n) generates invalid `LIMIT n` SQL instead of `TOP(n)`.
 * This plugin transforms the query AST before compilation, converting
 * LimitNode to TopNode on SELECT queries.
 *
 * WHY: MSSQL does not support the LIMIT keyword. It uses TOP(n) for
 * simple row limiting and OFFSET...FETCH for pagination.
 *
 * @example
 * ```typescript
 * import { Kysely, MssqlDialect } from 'kysely'
 * import { MssqlLimitPlugin } from './mssql-limit-plugin'
 *
 * const db = new Kysely({
 *     dialect: new MssqlDialect({...}),
 *     plugins: [new MssqlLimitPlugin()],
 * })
 *
 * // .limit() now works correctly on MSSQL
 * await db.selectFrom('users').selectAll().limit(10).execute()
 * // SQL: SELECT TOP(10) * FROM "users"
 * ```
 */
import {
    OperationNodeTransformer,
    type KyselyPlugin,
    type PluginTransformQueryArgs,
    type PluginTransformResultArgs,
    type QueryResult,
    type UnknownRow,
} from 'kysely';

import type { RootOperationNode } from 'kysely';

/**
 * AST transformer that rewrites LimitNode → TopNode on SELECT queries.
 *
 * Only transforms when:
 * - The SELECT has a limit but no top already set
 * - The limit value is a ValueNode containing a number
 */
class LimitToTopTransformer extends OperationNodeTransformer {

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected override transformSelectQuery(node: any): any {

        // Let parent transform children first (handles subqueries)
        const transformed = super.transformSelectQuery(node);

        // Only convert if there's a limit and no top already
        if (!transformed.limit || transformed.top) {

            return transformed;

        }

        // Extract the numeric value from the LimitNode
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const limitOp = transformed.limit.limit as any;
        let value: number | bigint | undefined;

        if (limitOp?.kind === 'ValueNode' && (typeof limitOp.value === 'number' || typeof limitOp.value === 'bigint')) {

            value = limitOp.value;

        }

        // Can't convert non-literal limits
        if (value === undefined) {

            return transformed;

        }

        // Replace limit with top
        return {
            ...transformed,
            limit: undefined,
            top: {
                kind: 'TopNode',
                expression: value,
            },
        };

    }

}

/**
 * Kysely plugin that patches .limit() for MSSQL compatibility.
 *
 * Add to the Kysely instance via the plugins option:
 *
 * @example
 * ```typescript
 * new Kysely({ dialect, plugins: [new MssqlLimitPlugin()] })
 * ```
 */
export class MssqlLimitPlugin implements KyselyPlugin {

    readonly #transformer = new LimitToTopTransformer();

    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {

        return this.#transformer.transformNode(args.node) as RootOperationNode;

    }

    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {

        return args.result;

    }

}
