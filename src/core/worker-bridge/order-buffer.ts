export class OrderBuffer<T> {

    #buffer = new Map<number, T>();
    #nextIndex = 0;
    #flush: (item: T) => void;

    constructor(flush: (item: T) => void) {

        this.#flush = flush;

    }

    get nextIndex(): number {

        return this.#nextIndex;

    }

    get pending(): number {

        return this.#buffer.size;

    }

    /**
     * Buffer an item at `index`, flushing every contiguous item from
     * `nextIndex` onwards.
     *
     * Rejects indices that can never flush. A duplicate, negative or
     * already-passed index would otherwise sit in the map forever and strand
     * every later item behind it — silent, unbounded, and indistinguishable
     * from a slow producer.
     */
    add(index: number, item: T): void {

        if (!Number.isInteger(index) || index < this.#nextIndex) {

            throw new Error(
                `OrderBuffer: index ${index} can never flush (next expected index is ${this.#nextIndex})`,
            );

        }

        if (this.#buffer.has(index)) {

            throw new Error(`OrderBuffer: duplicate index ${index}`);

        }

        this.#buffer.set(index, item);
        this.#drain();

    }

    #drain(): void {

        while (this.#buffer.has(this.#nextIndex)) {

            const item = this.#buffer.get(this.#nextIndex)!;
            this.#buffer.delete(this.#nextIndex);
            this.#nextIndex++;
            this.#flush(item);

        }

    }

}
