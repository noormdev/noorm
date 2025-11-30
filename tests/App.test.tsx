import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../src/App.js';

describe('App', () => {
    it('renders home screen by default', () => {
        const { lastFrame } = render(<App />);
        expect(lastFrame()).toContain('Home Screen');
    });

    it('shows navigation hints', () => {
        const { lastFrame } = render(<App />);
        expect(lastFrame()).toContain('[s] Settings');
        expect(lastFrame()).toContain('[a] About');
        expect(lastFrame()).toContain('[q] Quit');
    });
});
