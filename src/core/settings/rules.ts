/**
 * Rule Evaluation
 *
 * Evaluates stage-based rules against a config to determine
 * which folders should be included or excluded from builds.
 *
 * Rules use AND matching - all conditions in a rule must match.
 * Multiple rules are evaluated in order; later rules can override earlier ones.
 */
import type {
    Rule,
    RuleMatch,
    RuleEvaluationResult,
    RulesEvaluationResult,
    ConfigForRuleMatch,
} from './types.js';

/**
 * Check if a single condition matches.
 *
 * @example
 * ```typescript
 * matchesCondition({ isTest: true }, 'isTest', true)  // true
 * matchesCondition({ isTest: false }, 'isTest', true) // false
 * ```
 */
function _matchesCondition<K extends keyof RuleMatch>(
    config: ConfigForRuleMatch,
    key: K,
    expected: RuleMatch[K],
): boolean {

    if (expected === undefined) {

        return true;

    }

    return config[key as keyof ConfigForRuleMatch] === expected;

}

/**
 * Check if all conditions in a rule match the config.
 *
 * All specified conditions must be true (AND logic).
 *
 * @example
 * ```typescript
 * const rule = { match: { isTest: true, type: 'local' } }
 * const config = { name: 'dev', isTest: true, type: 'local', protected: false }
 *
 * ruleMatches(rule.match, config)  // true
 * ```
 */
export function ruleMatches(match: RuleMatch, config: ConfigForRuleMatch): boolean {

    // Check each condition - all must match (AND logic)
    if (match.name !== undefined && config.name !== match.name) {

        return false;

    }

    if (match.protected !== undefined && config.protected !== match.protected) {

        return false;

    }

    if (match.isTest !== undefined && config.isTest !== match.isTest) {

        return false;

    }

    if (match.type !== undefined && config.type !== match.type) {

        return false;

    }

    return true;

}

/**
 * Evaluate a single rule against a config.
 *
 * Returns the matched status and any include/exclude paths from the rule.
 *
 * @example
 * ```typescript
 * const rule = {
 *     match: { isTest: true },
 *     include: ['schema/seeds'],
 * }
 *
 * const result = evaluateRule(rule, testConfig)
 * // { matched: true, include: ['schema/seeds'], exclude: [] }
 * ```
 */
export function evaluateRule(rule: Rule, config: ConfigForRuleMatch): RuleEvaluationResult {

    const matched = ruleMatches(rule.match, config);

    if (!matched) {

        return {
            matched: false,
            include: [],
            exclude: [],
        };

    }

    return {
        matched: true,
        include: rule.include ?? [],
        exclude: rule.exclude ?? [],
    };

}

/**
 * Evaluate all rules against a config.
 *
 * Rules are evaluated in order. Later rules can override earlier ones:
 * - If a folder is in both include and exclude, the later rule wins
 *
 * @example
 * ```typescript
 * const rules = [
 *     { match: { isTest: true }, include: ['schema/seeds'] },
 *     { match: { protected: true }, exclude: ['schema/dangerous'] },
 * ]
 *
 * const result = evaluateRules(rules, config)
 * // { matchedRules: [...], include: ['schema/seeds'], exclude: ['schema/dangerous'] }
 * ```
 */
export function evaluateRules(rules: Rule[], config: ConfigForRuleMatch): RulesEvaluationResult {

    const matchedRules: Rule[] = [];
    const includeSet = new Set<string>();
    const excludeSet = new Set<string>();

    for (const rule of rules) {

        const result = evaluateRule(rule, config);

        if (result.matched) {

            matchedRules.push(rule);

            // Add includes (remove from exclude if present)
            for (const path of result.include) {

                includeSet.add(path);
                excludeSet.delete(path);

            }

            // Add excludes (remove from include if present)
            for (const path of result.exclude) {

                excludeSet.add(path);
                includeSet.delete(path);

            }

        }

    }

    return {
        matchedRules,
        include: Array.from(includeSet),
        exclude: Array.from(excludeSet),
    };

}

/**
 * Merge build config includes/excludes with rule evaluation results.
 *
 * Build config provides the base include/exclude lists.
 * Rule results modify these lists based on the active config.
 *
 * @param buildInclude - Base include list from build config
 * @param buildExclude - Base exclude list from build config
 * @param ruleResult - Result from evaluateRules
 *
 * @example
 * ```typescript
 * const buildInclude = ['schema/tables', 'schema/views']
 * const buildExclude = ['schema/archive']
 * const ruleResult = evaluateRules(rules, config)
 *
 * const { include, exclude } = mergeWithBuildConfig(
 *     buildInclude,
 *     buildExclude,
 *     ruleResult
 * )
 * ```
 */
export function mergeWithBuildConfig(
    buildInclude: string[],
    buildExclude: string[],
    ruleResult: RulesEvaluationResult,
): { include: string[]; exclude: string[] } {

    // Start with build config
    const includeSet = new Set(buildInclude);
    const excludeSet = new Set(buildExclude);

    // Apply rule includes (add to include, remove from exclude)
    for (const path of ruleResult.include) {

        includeSet.add(path);
        excludeSet.delete(path);

    }

    // Apply rule excludes (add to exclude, remove from include)
    for (const path of ruleResult.exclude) {

        excludeSet.add(path);
        includeSet.delete(path);

    }

    return {
        include: Array.from(includeSet),
        exclude: Array.from(excludeSet),
    };

}

/**
 * Get effective build paths for a config.
 *
 * Combines build config with evaluated rules to determine
 * the final include/exclude lists for a build operation.
 *
 * @param buildInclude - Base include list from settings.build.include
 * @param buildExclude - Base exclude list from settings.build.exclude
 * @param rules - Rules from settings.rules
 * @param config - Config to evaluate rules against
 *
 * @example
 * ```typescript
 * const settings = await settingsManager.load()
 * const config = state.getActiveConfig()
 *
 * const { include, exclude } = getEffectiveBuildPaths(
 *     settings.build?.include ?? ['schema'],
 *     settings.build?.exclude ?? [],
 *     settings.rules ?? [],
 *     config
 * )
 *
 * // Use include/exclude for the build
 * ```
 */
export function getEffectiveBuildPaths(
    buildInclude: string[],
    buildExclude: string[],
    rules: Rule[],
    config: ConfigForRuleMatch,
): { include: string[]; exclude: string[] } {

    const ruleResult = evaluateRules(rules, config);

    return mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

}
