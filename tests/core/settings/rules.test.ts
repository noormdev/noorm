import { describe, it, expect } from 'vitest';

import {
    ruleMatches,
    evaluateRule,
    evaluateRules,
    mergeWithBuildConfig,
    getEffectiveBuildPaths,
} from '../../../src/core/settings/rules.js';

import type { Rule, ConfigForRuleMatch } from '../../../src/core/settings/types.js';

describe('settings: rule evaluation', () => {

    // Test configs
    const devConfig: ConfigForRuleMatch = {
        name: 'dev',
        type: 'local',
        isTest: false,
        protected: false,
    };

    const testConfig: ConfigForRuleMatch = {
        name: 'test',
        type: 'local',
        isTest: true,
        protected: false,
    };

    const prodConfig: ConfigForRuleMatch = {
        name: 'prod',
        type: 'remote',
        isTest: false,
        protected: true,
    };

    const stagingConfig: ConfigForRuleMatch = {
        name: 'staging',
        type: 'remote',
        isTest: true,
        protected: false,
    };

    describe('ruleMatches', () => {

        it('should match when all conditions are met', () => {

            const match = { isTest: true };

            expect(ruleMatches(match, testConfig)).toBe(true);

        });

        it('should not match when condition is false', () => {

            const match = { isTest: true };

            expect(ruleMatches(match, devConfig)).toBe(false);

        });

        it('should match name condition', () => {

            const match = { name: 'dev' };

            expect(ruleMatches(match, devConfig)).toBe(true);
            expect(ruleMatches(match, prodConfig)).toBe(false);

        });

        it('should match protected condition', () => {

            const match = { protected: true };

            expect(ruleMatches(match, prodConfig)).toBe(true);
            expect(ruleMatches(match, devConfig)).toBe(false);

        });

        it('should match type condition', () => {

            const match = { type: 'remote' as const };

            expect(ruleMatches(match, prodConfig)).toBe(true);
            expect(ruleMatches(match, devConfig)).toBe(false);

        });

        it('should require ALL conditions to match (AND logic)', () => {

            const match = {
                isTest: true,
                type: 'local' as const,
            };

            // testConfig: isTest=true, type=local -> matches
            expect(ruleMatches(match, testConfig)).toBe(true);

            // stagingConfig: isTest=true, type=remote -> no match (type differs)
            expect(ruleMatches(match, stagingConfig)).toBe(false);

            // devConfig: isTest=false, type=local -> no match (isTest differs)
            expect(ruleMatches(match, devConfig)).toBe(false);

        });

        it('should match empty conditions (vacuously true)', () => {

            // Edge case: empty match should match everything
            // But our schema validation requires at least one condition
            // This tests the function behavior directly
            const match = {};

            expect(ruleMatches(match, devConfig)).toBe(true);

        });

    });

    describe('evaluateRule', () => {

        it('should return matched=true with include paths when rule matches', () => {

            const rule: Rule = {
                match: { isTest: true },
                include: ['sql/seeds', 'sql/test-data'],
            };

            const result = evaluateRule(rule, testConfig);

            expect(result.matched).toBe(true);
            expect(result.include).toEqual(['sql/seeds', 'sql/test-data']);
            expect(result.exclude).toEqual([]);

        });

        it('should return matched=true with exclude paths when rule matches', () => {

            const rule: Rule = {
                match: { protected: true },
                exclude: ['sql/dangerous'],
            };

            const result = evaluateRule(rule, prodConfig);

            expect(result.matched).toBe(true);
            expect(result.include).toEqual([]);
            expect(result.exclude).toEqual(['sql/dangerous']);

        });

        it('should return matched=false with empty paths when rule does not match', () => {

            const rule: Rule = {
                match: { isTest: true },
                include: ['sql/seeds'],
            };

            const result = evaluateRule(rule, devConfig);

            expect(result.matched).toBe(false);
            expect(result.include).toEqual([]);
            expect(result.exclude).toEqual([]);

        });

        it('should return both include and exclude when rule has both', () => {

            const rule: Rule = {
                match: { type: 'local' },
                include: ['sql/local-only'],
                exclude: ['sql/remote-only'],
            };

            const result = evaluateRule(rule, devConfig);

            expect(result.matched).toBe(true);
            expect(result.include).toEqual(['sql/local-only']);
            expect(result.exclude).toEqual(['sql/remote-only']);

        });

    });

    describe('evaluateRules', () => {

        it('should return empty results when no rules match', () => {

            const rules: Rule[] = [{ match: { isTest: true }, include: ['sql/seeds'] }];

            const result = evaluateRules(rules, devConfig); // isTest=false

            expect(result.matchedRules).toEqual([]);
            expect(result.include).toEqual([]);
            expect(result.exclude).toEqual([]);

        });

        it('should combine includes from multiple matching rules', () => {

            const rules: Rule[] = [
                { match: { type: 'local' }, include: ['sql/local'] },
                { match: { isTest: false }, include: ['sql/main'] },
            ];

            const result = evaluateRules(rules, devConfig);

            expect(result.matchedRules.length).toBe(2);
            expect(result.include).toContain('sql/local');
            expect(result.include).toContain('sql/main');

        });

        it('should combine excludes from multiple matching rules', () => {

            const rules: Rule[] = [
                { match: { protected: true }, exclude: ['sql/dangerous'] },
                { match: { type: 'remote' }, exclude: ['sql/local-only'] },
            ];

            const result = evaluateRules(rules, prodConfig);

            expect(result.matchedRules.length).toBe(2);
            expect(result.exclude).toContain('sql/dangerous');
            expect(result.exclude).toContain('sql/local-only');

        });

        it('should let later rules override earlier rules', () => {

            // First rule includes 'sql/seeds'
            // Second rule excludes 'sql/seeds'
            // Later rule wins, so 'sql/seeds' should be excluded
            const rules: Rule[] = [
                { match: { type: 'local' }, include: ['sql/seeds'] },
                { match: { isTest: false }, exclude: ['sql/seeds'] },
            ];

            const result = evaluateRules(rules, devConfig);

            expect(result.include).not.toContain('sql/seeds');
            expect(result.exclude).toContain('sql/seeds');

        });

        it('should remove from exclude when later rule includes', () => {

            // First rule excludes 'sql/special'
            // Second rule includes 'sql/special'
            // Later rule wins
            const rules: Rule[] = [
                { match: { type: 'local' }, exclude: ['sql/special'] },
                { match: { name: 'dev' }, include: ['sql/special'] },
            ];

            const result = evaluateRules(rules, devConfig);

            expect(result.include).toContain('sql/special');
            expect(result.exclude).not.toContain('sql/special');

        });

        it('should not include rules that do not match', () => {

            const rules: Rule[] = [
                { match: { isTest: true }, include: ['sql/seeds'] },
                { match: { protected: true }, exclude: ['sql/dangerous'] },
            ];

            const result = evaluateRules(rules, devConfig);

            // devConfig: isTest=false, protected=false
            // Neither rule should match
            expect(result.matchedRules.length).toBe(0);

        });

    });

    describe('mergeWithBuildConfig', () => {

        it('should combine build config with rule results', () => {

            const buildInclude = ['sql/tables', 'sql/views'];
            const buildExclude = ['sql/archive'];

            const ruleResult = {
                matchedRules: [],
                include: ['sql/seeds'],
                exclude: ['sql/heavy'],
            };

            const result = mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

            // Should have all build includes plus rule includes
            expect(result.include).toContain('sql/tables');
            expect(result.include).toContain('sql/views');
            expect(result.include).toContain('sql/seeds');

            // Should have all build excludes plus rule excludes
            expect(result.exclude).toContain('sql/archive');
            expect(result.exclude).toContain('sql/heavy');

        });

        it('should let rule results override build config', () => {

            const buildInclude = ['sql/main'];
            const buildExclude = ['sql/seeds']; // Normally excluded

            const ruleResult = {
                matchedRules: [],
                include: ['sql/seeds'], // Rule says include it
                exclude: [],
            };

            const result = mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

            // sql/seeds should be included (rule override)
            expect(result.include).toContain('sql/seeds');
            expect(result.exclude).not.toContain('sql/seeds');

        });

        it('should let exclude override include', () => {

            const buildInclude = ['sql/main', 'sql/dangerous'];
            const buildExclude: string[] = [];

            const ruleResult = {
                matchedRules: [],
                include: [],
                exclude: ['sql/dangerous'], // Rule says exclude it
            };

            const result = mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

            // sql/dangerous should be excluded
            expect(result.include).toContain('sql/main');
            expect(result.include).not.toContain('sql/dangerous');
            expect(result.exclude).toContain('sql/dangerous');

        });

    });

    describe('getEffectiveBuildPaths', () => {

        it('should return build config paths when no rules match', () => {

            const buildInclude = ['sql/tables', 'sql/views'];
            const buildExclude = ['sql/archive'];
            const rules: Rule[] = [{ match: { isTest: true }, include: ['sql/seeds'] }];

            const result = getEffectiveBuildPaths(
                buildInclude,
                buildExclude,
                rules,
                devConfig, // isTest=false, so rule won't match
            );

            expect(result.include).toEqual(['sql/tables', 'sql/views']);
            expect(result.exclude).toEqual(['sql/archive']);

        });

        it('should include rule paths when rules match', () => {

            const buildInclude = ['sql/tables'];
            const buildExclude: string[] = [];
            const rules: Rule[] = [{ match: { isTest: true }, include: ['sql/seeds'] }];

            const result = getEffectiveBuildPaths(
                buildInclude,
                buildExclude,
                rules,
                testConfig, // isTest=true, rule matches
            );

            expect(result.include).toContain('sql/tables');
            expect(result.include).toContain('sql/seeds');

        });

        it('should handle complex rule scenarios', () => {

            const buildInclude = ['sql/tables', 'sql/views', 'sql/functions'];
            const buildExclude = ['sql/archive'];
            const rules: Rule[] = [
                // Include seeds for test databases
                { match: { isTest: true }, include: ['sql/seeds'] },
                // Exclude dangerous scripts for protected configs
                { match: { protected: true }, exclude: ['sql/dangerous'] },
                // Exclude heavy seeds for remote test databases
                { match: { isTest: true, type: 'remote' }, exclude: ['sql/heavy-seeds'] },
            ];

            // For stagingConfig: isTest=true, type=remote, protected=false
            const result = getEffectiveBuildPaths(buildInclude, buildExclude, rules, stagingConfig);

            // Should include base + seeds (from isTest rule)
            expect(result.include).toContain('sql/tables');
            expect(result.include).toContain('sql/seeds');

            // Should exclude archive (from build) + heavy-seeds (from remote test rule)
            expect(result.exclude).toContain('sql/archive');
            expect(result.exclude).toContain('sql/heavy-seeds');

            // Should NOT exclude dangerous (protected=false)
            expect(result.exclude).not.toContain('sql/dangerous');

        });

    });

});
