import { Semaphore } from '@/utils/semaphore';

/**
 * Mutual exclusion per file path, so two writers never read-modify-write the
 * same locale file at once.
 *
 * A lock is a `Semaphore(1)`; the semaphore already provides the FIFO wait
 * queue, so this class only owns the per-path bookkeeping.
 */
export class FileLock {
    private locks: Map<string, { semaphore: Semaphore; holders: number }> = new Map();

    async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
        const entry = this.retain(filePath);
        await entry.semaphore.acquire();

        try {
            return await fn();
        } finally {
            entry.semaphore.release();
            this.release(filePath);
        }
    }

    /** Get (or create) the lock for a path and record one more interested caller */
    private retain(filePath: string): { semaphore: Semaphore; holders: number } {
        let entry = this.locks.get(filePath);
        if (!entry) {
            entry = { semaphore: new Semaphore(1), holders: 0 };
            this.locks.set(filePath, entry);
        }
        entry.holders++;
        return entry;
    }

    /** Drop the lock once nobody holds or waits for it, so the map cannot grow without bound */
    private release(filePath: string): void {
        const entry = this.locks.get(filePath);
        if (!entry) {
            return;
        }

        entry.holders--;
        if (entry.holders === 0) {
            this.locks.delete(filePath);
        }
    }
}
