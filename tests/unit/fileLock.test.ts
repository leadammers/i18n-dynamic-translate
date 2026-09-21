import { describe, it, expect } from 'vitest';
import { FileLock } from '@/utils/fileLock';

describe('FileLock', () => {
    it('should execute function and return its result', async () => {
        const lock = new FileLock();
        const result = await lock.withLock('file.json', async () => 42);

        expect(result).toBe(42);
    });

    it('should serialize concurrent access to the same file', async () => {
        const lock = new FileLock();
        const order: string[] = [];

        const task = (id: string, delay: number) =>
            lock.withLock('file.json', async () => {
                order.push(`${id}:start`);
                await new Promise((r) => setTimeout(r, delay));
                order.push(`${id}:end`);
            });

        await Promise.all([task('a', 30), task('b', 10), task('c', 10)]);

        // Each task must fully complete before the next starts
        expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    });

    it('should allow concurrent access to different files', async () => {
        const lock = new FileLock();
        let concurrent = 0;
        let maxConcurrent = 0;

        const task = (file: string) =>
            lock.withLock(file, async () => {
                concurrent++;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                await new Promise((r) => setTimeout(r, 20));
                concurrent--;
            });

        await Promise.all([task('a.json'), task('b.json'), task('c.json')]);

        expect(maxConcurrent).toBe(3);
    });

    it('should release the lock even if the function throws', async () => {
        const lock = new FileLock();

        await expect(
            lock.withLock('file.json', async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');

        // Lock should be released, so a subsequent call should succeed
        const result = await lock.withLock('file.json', async () => 'ok');
        expect(result).toBe('ok');
    });

    it('should process queued operations in FIFO order', async () => {
        const lock = new FileLock();
        const order: number[] = [];

        // Hold the lock so subsequent calls queue up
        const hold = lock.withLock('file.json', async () => {
            await new Promise((r) => setTimeout(r, 30));
            order.push(0);
        });

        const p1 = lock.withLock('file.json', async () => order.push(1));
        const p2 = lock.withLock('file.json', async () => order.push(2));
        const p3 = lock.withLock('file.json', async () => order.push(3));

        await Promise.all([hold, p1, p2, p3]);

        expect(order).toEqual([0, 1, 2, 3]);
    });
});
