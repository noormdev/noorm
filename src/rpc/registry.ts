import type { RpcCommand, RpcCommandInfo } from './types.js';

/**
 * Flat command registry.
 *
 * Stores RPC commands by name. Provides lookup, listing,
 * and help generation from command definitions and Zod schemas.
 */
export class RpcRegistry {

    #commands = new Map<string, RpcCommand>();

    /**
     * Register a command.
     */
    register(command: RpcCommand): void {

        this.#commands.set(command.name, command);

    }

    /**
     * Look up a command by name.
     */
    get(name: string): RpcCommand | undefined {

        return this.#commands.get(name);

    }

    /**
     * List all registered commands with names and descriptions.
     */
    list(): RpcCommandInfo[] {

        const entries: RpcCommandInfo[] = [];

        for (const cmd of this.#commands.values()) {

            entries.push({ name: cmd.name, description: cmd.description });

        }

        return entries;

    }

    /**
     * Generate help text for a command.
     *
     * Includes description, parameter docs from Zod schema, and examples.
     */
    getHelp(name: string): string | undefined {

        const cmd = this.#commands.get(name);

        if (!cmd) return undefined;

        const lines: string[] = [
            `# ${cmd.name}`,
            '',
            cmd.description,
            '',
        ];

        // Extract parameters from Zod schema shape
        const shape = 'shape' in cmd.inputSchema
            ? (cmd.inputSchema as { shape: Record<string, { description?: string; isOptional?: () => boolean }> }).shape
            : null;

        if (shape && Object.keys(shape).length > 0) {

            lines.push('## Parameters', '');

            for (const [key, field] of Object.entries(shape)) {

                const desc = field.description ?? '';
                const optional = typeof field.isOptional === 'function' && field.isOptional();
                const suffix = optional ? ' (optional)' : '';

                lines.push(`- **${key}**${suffix}: ${desc}`);

            }

            lines.push('');

        }

        if (cmd.examples.length > 0) {

            lines.push('## Examples', '');

            for (const example of cmd.examples) {

                lines.push(`**${example.description}:**`);
                lines.push('```json');
                lines.push(JSON.stringify(example.input, null, 4));
                lines.push('```');
                lines.push('');

            }

        }

        return lines.join('\n');

    }

}
