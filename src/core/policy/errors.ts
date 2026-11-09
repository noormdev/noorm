/**
 * Thrown for an access role no built-in or settings role defines.
 *
 * @example
 * if (err instanceof UnknownAccessRoleError) hideConfig(err.role)
 */
export class UnknownAccessRoleError extends Error {

    override readonly name = 'UnknownAccessRoleError' as const;

    constructor(public readonly role: string) {

        super(`Unknown access role "${role}"`);

    }

}
