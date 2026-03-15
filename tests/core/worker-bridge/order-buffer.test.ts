import { describe, it, expect } from 'bun:test';
import { OrderBuffer } from '../../../src/core/worker-bridge/order-buffer.js';

describe('worker-bridge: OrderBuffer', () => {

    it('should flush items arriving in order', () => {

        const flushed: string[] = [];
        const buffer = new OrderBuffer<string>(item => {

            flushed.push(item);

        });

        buffer.add(0, 'a');
        buffer.add(1, 'b');
        buffer.add(2, 'c');

        expect(flushed).toEqual(['a', 'b', 'c']);

    });

    it('should buffer out-of-order items and flush when gap fills', () => {

        const flushed: string[] = [];
        const buffer = new OrderBuffer<string>(item => {

            flushed.push(item);

        });

        buffer.add(2, 'c');  // buffered — waiting for 0
        buffer.add(0, 'a');  // flush 'a', still waiting for 1
        buffer.add(1, 'b');  // flush 'b', then 'c' (was buffered)

        expect(flushed).toEqual(['a', 'b', 'c']);

    });

    it('should report pending count', () => {

        const buffer = new OrderBuffer<string>(() => {});

        buffer.add(2, 'c');
        buffer.add(4, 'e');
        expect(buffer.pending).toBe(2);

        buffer.add(0, 'a');
        buffer.add(1, 'b');
        // 0,1,2 flush → only 4 remains pending
        expect(buffer.pending).toBe(1);

    });

    it('should report nextIndex', () => {

        const buffer = new OrderBuffer<string>(() => {});

        expect(buffer.nextIndex).toBe(0);
        buffer.add(0, 'a');
        expect(buffer.nextIndex).toBe(1);

    });

    it('should handle large gaps', () => {

        const flushed: number[] = [];
        const buffer = new OrderBuffer<number>(item => {

            flushed.push(item);

        });

        buffer.add(5, 50);
        buffer.add(3, 30);
        buffer.add(1, 10);
        buffer.add(0, 0);
        buffer.add(2, 20);
        buffer.add(4, 40);

        expect(flushed).toEqual([0, 10, 20, 30, 40, 50]);

    });

});
