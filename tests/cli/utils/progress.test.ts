import { describe, expect, it } from 'bun:test';

import { progressPercentage } from '../../../src/tui/utils/progress.js';

describe('tui progress: progressPercentage', () => {

    it('should convert completed work to the ProgressBar percentage scale', () => {

        expect(progressPercentage(1, 2)).toBe(50);

    });

    it('should keep unknown and over-counted progress within component bounds', () => {

        expect(progressPercentage(4, 0)).toBe(0);
        expect(progressPercentage(-1, 4)).toBe(0);
        expect(progressPercentage(5, 4)).toBe(100);

    });

});
