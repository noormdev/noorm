/**
 * Settings rules list row-identity tests.
 *
 * Rule descriptions are free text with no uniqueness check, and the rule edit
 * screen saves by removing the rule and appending it, so neither the
 * description alone nor the position identifies a rule across a save.
 */
import { describe, it, expect } from 'bun:test';

import type { Rule } from '../../../../src/core/settings/types.js';

import { ruleListItems } from '../../../../src/tui/screens/settings/SettingsRulesListScreen.js';

describe('cli: settings rules list row identity', () => {

    it('should give every rule its own row', () => {

        const rules: Rule[] = [
            { match: { isTest: true } },
            { description: 'Exclude test tables', match: { isTest: true }, exclude: ['seeds'] },
            { description: 'Exclude test tables', match: { protected: true }, exclude: ['seeds'] },
            { description: '0', match: { protected: true } },
        ];

        const keys = ruleListItems(rules).map((item) => item.key);

        expect(new Set(keys).size).toBe(rules.length);

    });

    it('should keep a described rule\'s key apart from every position', () => {

        // Description `1`, first occurrence, against the undescribed rule at
        // index 11: joined without a separator both would read `11`.
        const rules: Rule[] = [
            { description: '1', match: { isTest: true } },
            ...Array.from({ length: 11 }, (): Rule => ({ match: { protected: true } })),
        ];

        const keys = ruleListItems(rules).map((item) => item.key);

        expect(new Set(keys).size).toBe(rules.length);

    });

    it('should keep a rule\'s key when saving an edit moves it to the end', () => {

        const seeds: Rule = { description: 'Seeds', match: { isTest: true } };
        const prod: Rule = { description: 'Prod', match: { protected: true } };
        const local: Rule = { description: 'Local', match: { type: 'local' } };

        const keyOfSeeds = (rules: Rule[]) => ruleListItems(rules).find((item) => item.value.rule === seeds)?.key;

        // The list remembers the cursor by key, so this is what puts it back on
        // the rule the user just edited.
        expect(keyOfSeeds([seeds, prod, local])).toBeDefined();
        expect(keyOfSeeds([prod, local, seeds])).toBe(keyOfSeeds([seeds, prod, local]));

    });

});
