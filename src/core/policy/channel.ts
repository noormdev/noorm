/**
 * Channel resolution.
 *
 * `Channel` names *who is driving*, not which binary was invoked. Those
 * coincide only when a human is at the keyboard, and the CLI used to assume
 * they always did: it hardcoded `user` at every policy call site. An agent
 * denied `sql:write` over MCP could see `noorm` on the PATH, shell out, and
 * get the human's role — `sql:write`, `sql:ddl`, `db:create`, `run:build`
 * and `vault:read` all flipped from deny to allow on a stock config, and
 * `db:destroy` dropped to a confirm that `--yes` walks straight through.
 *
 * Resolving the channel from provenance is what closes that.
 */
import { isAgentSession } from './harness.js';
import type { Channel } from './types.js';

/**
 * Escape hatch for a human scripting from inside an agent session.
 *
 * A `NOORM_CHANNEL=agent` is equally available to an agent, and that is
 * accepted: this defends against an agent routing around a refusal, not one
 * that sets out to evade the check. An agent willing to unset the harness
 * variables was never going to be stopped by reading them.
 */
const CHANNEL_ENV_VAR = 'NOORM_CHANNEL';

function isChannel(value: unknown): value is Channel {

    return value === 'user' || value === 'agent';

}

/**
 * Resolve the channel this process is acting on behalf of.
 *
 * Precedence:
 *
 * 1. `NOORM_CHANNEL`, when set to exactly `user` or `agent`. Any other value
 *    is ignored rather than treated as an error — a typo must not silently
 *    grant the looser channel, and it must not break the CLI either.
 * 2. Harness provenance via `isAgentSession()` — an allowlist of variables
 *    the agent harnesses set for their own child processes.
 * 3. `user`.
 *
 * The MCP server sits *above* this: it constructs its session with `agent`
 * literally (`src/mcp/index.ts`) and never calls this function, so stdio
 * traffic is `agent` even under `NOORM_CHANNEL=user`.
 *
 * Pure over its input so tests need not mutate `process.env`, which Bun
 * caches for the life of the process and leaks across test files.
 *
 * @example
 * resolveChannel({});                          // 'user'
 * resolveChannel({ CLAUDECODE: '1' });         // 'agent'
 * resolveChannel({ CLAUDECODE: '1', NOORM_CHANNEL: 'user' }); // 'user'
 */
export function resolveChannel(env: Record<string, string | undefined> = process.env): Channel {

    const override = env[CHANNEL_ENV_VAR];

    if (isChannel(override)) return override;

    return isAgentSession(env) ? 'agent' : 'user';

}
