import { describe, it } from 'bun:test';

describe('debug: pid', () => {

    it('logs pid from cli test', () => {
        console.log('[debug-pid-cli] PID:', process.pid);
    });

});
