/**
 * File write lock to prevent concurrent writes to the same file
 * Uses a queue-based approach to eliminate race conditions and busy-waiting
 */
export class FileLock {
    private locks: Map<string, Array<() => void>> = new Map();
    private activeLocks: Set<string> = new Set();

    async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
        // Acquire lock (wait if file is currently locked)
        await this.acquire(filePath);

        try {
            return await fn();
        } finally {
            this.release(filePath);
        }
    }

    private async acquire(filePath: string): Promise<void> {
        // If not locked, acquire immediately
        if (!this.activeLocks.has(filePath)) {
            this.activeLocks.add(filePath);
            return;
        }

        // File is locked - add to waiting queue
        return new Promise<void>((resolve) => {
            if (!this.locks.has(filePath)) {
                this.locks.set(filePath, []);
            }
            this.locks.get(filePath)!.push(resolve);
        });
    }

    private release(filePath: string): void {
        const waitingQueue = this.locks.get(filePath);

        // Process next waiter in queue (FIFO)
        if (waitingQueue && waitingQueue.length > 0) {
            const next = waitingQueue.shift()!;
            if (waitingQueue.length === 0) {
                this.locks.delete(filePath);
            }
            next(); // Transfer lock to next waiter
        } else {
            // No waiters - release lock
            this.activeLocks.delete(filePath);
            this.locks.delete(filePath);
        }
    }
}
