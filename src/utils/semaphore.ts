/**
 * Simple semaphore for concurrency control with FIFO ordering
 */
export class Semaphore {
    private permits: number;
    private waiting: Array<() => void> = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise<void>((resolve) => {
            this.waiting.push(resolve);
        });
    }

    release(): void {
        // Process waiting queue first (FIFO) before incrementing permits
        const next = this.waiting.shift();
        if (next) {
            // Don't increment permits - transfer directly to next waiter
            next();
        } else {
            // No waiters, return permit to pool
            this.permits++;
        }
    }
}
