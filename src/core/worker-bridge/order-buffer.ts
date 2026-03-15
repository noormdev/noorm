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

    add(index: number, item: T): void {

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
