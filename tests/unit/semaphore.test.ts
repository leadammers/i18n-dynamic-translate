import { describe, it, expect } from 'vitest';
import { Semaphore } from '@/utils/semaphore';

describe('Semaphore', () => {
    it('should resolve acquire immediately when permits are available', async () => {
        const semaphore = new Semaphore(2);

        // Both acquires should resolve immediately (no blocking)
        await semaphore.acquire();
        await semaphore.acquire();
    });

    it('should block acquire when no permits are available', async () => {
        const semaphore = new Semaphore(1);
        await semaphore.acquire();

        let acquired = false;
        const pending = semaphore.acquire().then(() => {
            acquired = true;
        });

        // Give microtasks a chance to flush
        await Promise.resolve();
        expect(acquired).toBe(false);

        semaphore.release();
        await pending;
        expect(acquired).toBe(true);
    });

    it('should unblock waiting acquirers in FIFO order', async () => {
        const semaphore = new Semaphore(1);
        await semaphore.acquire();

        const order: number[] = [];

        const p1 = semaphore.acquire().then(() => order.push(1));
        const p2 = semaphore.acquire().then(() => order.push(2));
        const p3 = semaphore.acquire().then(() => order.push(3));

        semaphore.release();
        await p1;

        semaphore.release();
        await p2;

        semaphore.release();
        await p3;

        expect(order).toEqual([1, 2, 3]);
    });

    it('should allow the correct number of concurrent acquires', async () => {
        const semaphore = new Semaphore(2);
        let running = 0;
        let maxRunning = 0;

        const task = async () => {
            await semaphore.acquire();
            running++;
            maxRunning = Math.max(maxRunning, running);
            // Simulate async work
            await new Promise((r) => setTimeout(r, 10));
            running--;
            semaphore.release();
        };

        await Promise.all([task(), task(), task(), task()]);

        expect(maxRunning).toBe(2);
    });

    it('should increase permits when release is called without prior acquire', () => {
        const semaphore = new Semaphore(1);
        semaphore.release();

        // Now there should be 2 permits, so two acquires should resolve immediately
        let resolved = 0;
        semaphore.acquire().then(() => resolved++);
        semaphore.acquire().then(() => resolved++);

        // Return a microtask flush to let the promises resolve
        return Promise.resolve().then(() => {
            expect(resolved).toBe(2);
        });
    });
});
