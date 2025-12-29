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
                include: ['schema/seeds', 'schema/test-data'],
            };

            const result = evaluateRule(rule, testConfig);

            expect(result.matched).toBe(true);
            expect(result.include).toEqual(['schema/seeds', 'schema/test-data']);
            expect(result.exclude).toEqual([]);

        });

        it('should return matched=true with exclude paths when rule matches', () => {

            const rule: Rule = {
                match: { protected: true },
                exclude: ['schema/dangerous'],
            };

            const result = evaluateRule(rule, prodConfig);

            expect(result.matched).toBe(true);
            expect(result.include).toEqual([]);
            expect(result.exclude).toEqual(['schema/dangerous']);

        });

        it('should return matched=false with empty paths when rule does not match', () => {

            const rule: Rule = {
                match: { isTest: true },
                include: ['schema/seeds'],
            };

            const result = evaluateRule(rule, devConfig);

            expect(result.matched).toBe(false);
            expect(result.include).toEqual([]);
            expect(result.exclude).toEqual([]);

        });

        it('should return both include and exclude when rule has both', () => {

            const rule: Rule = {
                match: { type: 'local' },
                include: ['schema/local-only'],
                exclude: ['schema/remote-only'],
            };

            const result = evaluateRule(rule, devConfig);

            expect(result.matched).toBe(true);
            expect(result.include).toEqual(['schema/local-only']);
            expect(result.exclude).toEqual(['schema/remote-only']);

        });

    });

    describe('evaluateRules', () => {

        it('should return empty results when no rules match', () => {

            const rules: Rule[] = [{ match: { isTest: true }, include: ['schema/seeds'] }];

            const result = evaluateRules(rules, devConfig); // isTest=false

            expect(result.matchedRules).toEqual([]);
            expect(result.include).toEqual([]);
            expect(result.exclude).toEqual([]);

        });

        it('should combine includes from multiple matching rules', () => {

            const rules: Rule[] = [
                { match: { type: 'local' }, include: ['schema/local'] },
                { match: { isTest: false }, include: ['schema/main'] },
            ];

            const result = evaluateRules(rules, devConfig);

            expect(result.matchedRules.length).toBe(2);
            expect(result.include).toContain('schema/local');
            expect(result.include).toContain('schema/main');

        });

        it('should combine excludes from multiple matching rules', () => {

            const rules: Rule[] = [
                { match: { protected: true }, exclude: ['schema/dangerous'] },
                { match: { type: 'remote' }, exclude: ['schema/local-only'] },
            ];

            const result = evaluateRules(rules, prodConfig);

            expect(result.matchedRules.length).toBe(2);
            expect(result.exclude).toContain('schema/dangerous');
            expect(result.exclude).toContain('schema/local-only');

        });

        it('should let later rules override earlier rules', () => {

            // First rule includes 'schema/seeds'
            // Second rule excludes 'schema/seeds'
            // Later rule wins, so 'schema/seeds' should be excluded
            const rules: Rule[] = [
                { match: { type: 'local' }, include: ['schema/seeds'] },
                { match: { isTest: false }, exclude: ['schema/seeds'] },
            ];

            const result = evaluateRules(rules, devConfig);

            expect(result.include).not.toContain('schema/seeds');
            expect(result.exclude).toContain('schema/seeds');

        });

        it('should remove from exclude when later rule includes', () => {

            // First rule excludes 'schema/special'
            // Second rule includes 'schema/special'
            // Later rule wins
            const rules: Rule[] = [
                { match: { type: 'local' }, exclude: ['schema/special'] },
                { match: { name: 'dev' }, include: ['schema/special'] },
            ];

            const result = evaluateRules(rules, devConfig);

            expect(result.include).toContain('schema/special');
            expect(result.exclude).not.toContain('schema/special');

        });

        it('should not include rules that do not match', () => {

            const rules: Rule[] = [
                { match: { isTest: true }, include: ['schema/seeds'] },
                { match: { protected: true }, exclude: ['schema/dangerous'] },
            ];

            const result = evaluateRules(rules, devConfig);

            // devConfig: isTest=false, protected=false
            // Neither rule should match
            expect(result.matchedRules.length).toBe(0);

        });

    });

    describe('mergeWithBuildConfig', () => {

        it('should combine build config with rule results', () => {

            const buildInclude = ['schema/tables', 'schema/views'];
            const buildExclude = ['schema/archive'];

            const ruleResult = {
                matchedRules: [],
                include: ['schema/seeds'],
                exclude: ['schema/heavy'],
            };

            const result = mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

            // Should have all build includes plus rule includes
            expect(result.include).toContain('schema/tables');
            expect(result.include).toContain('schema/views');
            expect(result.include).toContain('schema/seeds');

            // Should have all build excludes plus rule excludes
            expect(result.exclude).toContain('schema/archive');
            expect(result.exclude).toContain('schema/heavy');

        });

        it('should let rule results override build config', () => {

            const buildInclude = ['schema/main'];
            const buildExclude = ['schema/seeds']; // Normally excluded

            const ruleResult = {
                matchedRules: [],
                include: ['schema/seeds'], // Rule says include it
                exclude: [],
            };

            const result = mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

            // schema/seeds should be included (rule override)
            expect(result.include).toContain('schema/seeds');
            expect(result.exclude).not.toContain('schema/seeds');

        });

        it('should let exclude override include', () => {

            const buildInclude = ['schema/main', 'schema/dangerous'];
            const buildExclude: string[] = [];

            const ruleResult = {
                matchedRules: [],
                include: [],
                exclude: ['schema/dangerous'], // Rule says exclude it
            };

            const result = mergeWithBuildConfig(buildInclude, buildExclude, ruleResult);

            // schema/dangerous should be excluded
            expect(result.include).toContain('schema/main');
            expect(result.include).not.toContain('schema/dangerous');
            expect(result.exclude).toContain('schema/dangerous');

        });

    });

    describe('getEffectiveBuildPaths', () => {

        it('should return build config paths when no rules match', () => {

            const buildInclude = ['schema/tables', 'schema/views'];
            const buildExclude = ['schema/archive'];
            const rules: Rule[] = [{ match: { isTest: true }, include: ['schema/seeds'] }];

            const result = getEffectiveBuildPaths(
                buildInclude,
                buildExclude,
                rules,
                devConfig, // isTest=false, so rule won't match
            );

            expect(result.include).toEqual(['schema/tables', 'schema/views']);
            expect(result.exclude).toEqual(['schema/archive']);

        });

        it('should include rule paths when rules match', () => {

            const buildInclude = ['schema/tables'];
            const buildExclude: string[] = [];
            const rules: Rule[] = [{ match: { isTest: true }, include: ['schema/seeds'] }];

            const result = getEffectiveBuildPaths(
                buildInclude,
                buildExclude,
                rules,
                testConfig, // isTest=true, rule matches
            );

            expect(result.include).toContain('schema/tables');
            expect(result.include).toContain('schema/seeds');

        });

        it('should handle complex rule scenarios', () => {

            const buildInclude = ['schema/tables', 'schema/views', 'schema/functions'];
            const buildExclude = ['schema/archive'];
            const rules: Rule[] = [
                // Include seeds for test databases
                { match: { isTest: true }, include: ['schema/seeds'] },
                // Exclude dangerous scripts for protected configs
                { match: { protected: true }, exclude: ['schema/dangerous'] },
                // Exclude heavy seeds for remote test databases
                { match: { isTest: true, type: 'remote' }, exclude: ['schema/heavy-seeds'] },
            ];

            // For stagingConfig: isTest=true, type=remote, protected=false
            const result = getEffectiveBuildPaths(buildInclude, buildExclude, rules, stagingConfig);

            // Should include base + seeds (from isTest rule)
            expect(result.include).toContain('schema/tables');
            expect(result.include).toContain('schema/seeds');

            // Should exclude archive (from build) + heavy-seeds (from remote test rule)
            expect(result.exclude).toContain('schema/archive');
            expect(result.exclude).toContain('schema/heavy-seeds');

            // Should NOT exclude dangerous (protected=false)
            expect(result.exclude).not.toContain('schema/dangerous');

        });

    });

});
