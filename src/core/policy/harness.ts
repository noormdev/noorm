/**
 * Agent-harness detection.
 *
 * An agent that is denied a write over MCP can see that `noorm` is on the
 * PATH and simply shell out to it. Before this existed the CLI hardcoded the
 * `user` channel, so that second attempt ran with the human's role — a config
 * whose agent role was `viewer` still let an agent drop the database through
 * the CLI. Resolving the channel from the environment is what closes that.
 *
 * This is an allowlist of markers the harnesses set themselves, not a
 * heuristic. Deliberately excluded: `TERM_PROGRAM`, `CI`, and TTY state. Those
 * describe the terminal or the pipeline, not the caller — `TERM_PROGRAM` is
 * set by iTerm, VS Code and Warp alike, so keying on it would classify a human
 * as an agent and lock them out of their own CLI. A false positive here is
 * worse than a false negative: it breaks the operator's tooling, while a miss
 * only leaves us where we already were.
 *
 * Detection is evadable — anything reading env is. It is aimed at an agent
 * that routes around a refusal, which is the realistic case, not one that sets
 * out to defeat the check. Treat it as provenance and a safer default, never
 * as a security boundary.
 *
 * @example
 * const harness = detectAgentHarness();
 * if (harness) console.log(`running under ${harness.name}`);
 */

/**
 * A harness noorm can recognise from the environment it exports.
 */
export interface AgentHarness {

    /** Stable id recorded in provenance. Never renamed once shipped. */
    id: string;

    /** Display name for messages and `noorm info`. */
    name: string;

    /** Environment variables whose presence identifies this harness. */
    markers: readonly string[];

}

/**
 * Harnesses we recognise, most specific first.
 *
 * Each entry is a variable the harness sets for its own child processes.
 * Adding one is a single line — but verify the variable is set by the harness
 * itself and is not something a user might plausibly export by hand, because
 * a wrong entry silently downgrades a human's permissions.
 */
export const AGENT_HARNESSES: readonly AgentHarness[] = [
    { id: 'claude-code', name: 'Claude Code', markers: ['CLAUDECODE', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT'] },
    { id: 'codex', name: 'OpenAI Codex', markers: ['CODEX_SANDBOX'] },
    { id: 'cursor', name: 'Cursor', markers: ['CURSOR_AGENT'] },
    { id: 'gemini-cli', name: 'Gemini CLI', markers: ['GEMINI_CLI'] },

    // Generic convention, and the self-declaration hatch for a harness that
    // is not listed above. Last so a specific match always wins the id.
    { id: 'generic', name: 'AI agent', markers: ['AI_AGENT', 'NOORM_AGENT'] },
];

/**
 * Whether an environment variable is meaningfully set.
 *
 * An exported-but-empty variable reads as absent: `CLAUDECODE=` is how a
 * caller disables the marker, and treating it as present would make that
 * impossible.
 */
function isSet(env: Record<string, string | undefined>, key: string): boolean {

    const value = env[key];

    return typeof value === 'string' && value.length > 0;

}

/**
 * Identify the agent harness driving this process, if any.
 *
 * Pure over its input so it can be tested without mutating `process.env` —
 * which matters here, because Bun caches some environment reads for the life
 * of the process and a test that mutates the real environment leaks into
 * every file that runs after it.
 *
 * @example
 * detectAgentHarness({ CLAUDECODE: '1' });     // { id: 'claude-code', ... }
 * detectAgentHarness({ TERM_PROGRAM: 'vscode' }); // null — a terminal, not an agent
 */
export function detectAgentHarness(
    env: Record<string, string | undefined> = process.env,
): AgentHarness | null {

    for (const harness of AGENT_HARNESSES) {

        if (harness.markers.some((marker) => isSet(env, marker))) {

            return harness;

        }

    }

    return null;

}

/**
 * Whether this process is being driven by an agent.
 *
 * @example
 * if (isAgentSession()) { /* resolve the agent channel *\/ }
 */
export function isAgentSession(env: Record<string, string | undefined> = process.env): boolean {

    return detectAgentHarness(env) !== null;

}
