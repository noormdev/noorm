import { attachPolicyContext, type ConfigAccess, type PolicyContext } from '../../src/core/policy/index.js';

/** Bind the policy context that config resolution would attach, so fixtures evaluate like resolved configs. */
export function withPolicy<T extends ConfigAccess>(access: T, context: PolicyContext = {}): T {

    attachPolicyContext(access, context);

    return access;

}
