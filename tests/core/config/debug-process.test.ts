import { describe, it } from 'bun:test';

describe('debug: process', () => {

    it('logs process pid', () => {
        console.log('[debug-process] PID:', process.pid);
        console.log('[debug-process] NOORM keys:', Object.keys(process.env).filter(k => k.startsWith('NOORM_')));
    });

});
