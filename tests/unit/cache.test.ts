import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryCache } from '@/utils/cache';

describe('MemoryCache', () => {
    let cache: MemoryCache;

    beforeEach(() => {
        cache = new MemoryCache();
    });

    describe('constructor', () => {
        it('should create cache with default TTL of 24 hours', () => {
            const cache = new MemoryCache();
            expect(cache).toBeDefined();
        });

        it('should create cache with custom TTL', () => {
            const customTtl = 60000; // 1 minute
            const cache = new MemoryCache(customTtl);
            expect(cache).toBeDefined();
        });
    });

    describe('set and get', () => {
        it('should store and retrieve a value', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            expect(cache.get({ key: 'hello', locale: 'en' })).toBe('Hello');
        });

        it('should store values for different locales separately', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            cache.set({ key: 'hello', locale: 'de' }, 'Hallo');
            cache.set({ key: 'hello', locale: 'fr' }, 'Bonjour');

            expect(cache.get({ key: 'hello', locale: 'en' })).toBe('Hello');
            expect(cache.get({ key: 'hello', locale: 'de' })).toBe('Hallo');
            expect(cache.get({ key: 'hello', locale: 'fr' })).toBe('Bonjour');
        });

        it('should store different keys for the same locale', () => {
            cache.set({ key: 'greeting', locale: 'en' }, 'Hello');
            cache.set({ key: 'farewell', locale: 'en' }, 'Goodbye');

            expect(cache.get({ key: 'greeting', locale: 'en' })).toBe('Hello');
            expect(cache.get({ key: 'farewell', locale: 'en' })).toBe('Goodbye');
        });

        it('should overwrite existing values', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            cache.set({ key: 'hello', locale: 'en' }, 'Hi');

            expect(cache.get({ key: 'hello', locale: 'en' })).toBe('Hi');
        });

        it('should return null for non-existent keys', () => {
            expect(cache.get({ key: 'nonexistent', locale: 'en' })).toBeNull();
        });

        it('should return null for non-existent locales', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            expect(cache.get({ key: 'hello', locale: 'de' })).toBeNull();
        });
    });

    describe('has', () => {
        it('should return true for existing entries', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            expect(cache.has({ key: 'hello', locale: 'en' })).toBe(true);
        });

        it('should return false for non-existent keys', () => {
            expect(cache.has({ key: 'nonexistent', locale: 'en' })).toBe(false);
        });

        it('should return false for non-existent locales', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            expect(cache.has({ key: 'hello', locale: 'de' })).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            cache.set({ key: 'world', locale: 'en' }, 'World');
            cache.set({ key: 'hello', locale: 'de' }, 'Hallo');

            cache.clear();

            expect(cache.get({ key: 'hello', locale: 'en' })).toBeNull();
            expect(cache.get({ key: 'world', locale: 'en' })).toBeNull();
            expect(cache.get({ key: 'hello', locale: 'de' })).toBeNull();
        });

        it('should reset cache size to 0', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            cache.set({ key: 'world', locale: 'en' }, 'World');

            cache.clear();

            expect(cache.getStats().size).toBe(0);
        });
    });

    describe('getStats', () => {
        it('should return correct size', () => {
            expect(cache.getStats().size).toBe(0);

            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            expect(cache.getStats().size).toBe(1);

            cache.set({ key: 'world', locale: 'en' }, 'World');
            expect(cache.getStats().size).toBe(2);

            cache.set({ key: 'hello', locale: 'de' }, 'Hallo');
            expect(cache.getStats().size).toBe(3);
        });

        it('counts one entry per distinct identity', () => {
            cache.set({ key: 'title', locale: 'de' }, 'Titel');
            cache.set({ key: 'title', locale: 'de', namespace: 'products' }, 'Produkttitel');
            cache.set({ key: 'title', locale: 'de', context: 'formal' }, 'Titel (formal)');
            cache.set({ key: 'title', locale: 'de' }, 'Titel, again');

            expect(cache.getStats().size).toBe(3);
        });
    });

    describe('TTL expiration', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return null for expired entries on get', () => {
            const shortTtlCache = new MemoryCache(1000); // 1 second TTL
            shortTtlCache.set({ key: 'hello', locale: 'en' }, 'Hello');

            expect(shortTtlCache.get({ key: 'hello', locale: 'en' })).toBe('Hello');

            // Advance time past TTL
            vi.advanceTimersByTime(1001);

            expect(shortTtlCache.get({ key: 'hello', locale: 'en' })).toBeNull();
        });

        it('should return false for expired entries on has', () => {
            const shortTtlCache = new MemoryCache(1000);
            shortTtlCache.set({ key: 'hello', locale: 'en' }, 'Hello');

            expect(shortTtlCache.has({ key: 'hello', locale: 'en' })).toBe(true);

            vi.advanceTimersByTime(1001);

            expect(shortTtlCache.has({ key: 'hello', locale: 'en' })).toBe(false);
        });

        it('should not expire entries within TTL', () => {
            const shortTtlCache = new MemoryCache(1000);
            shortTtlCache.set({ key: 'hello', locale: 'en' }, 'Hello');

            vi.advanceTimersByTime(500);

            expect(shortTtlCache.get({ key: 'hello', locale: 'en' })).toBe('Hello');
            expect(shortTtlCache.has({ key: 'hello', locale: 'en' })).toBe(true);
        });
    });

    describe('cleanup', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should remove expired entries and return count', () => {
            const shortTtlCache = new MemoryCache(1000);

            shortTtlCache.set({ key: 'old1', locale: 'en' }, 'Old 1');
            shortTtlCache.set({ key: 'old2', locale: 'en' }, 'Old 2');

            vi.advanceTimersByTime(1500);

            shortTtlCache.set({ key: 'new1', locale: 'en' }, 'New 1');

            const removed = shortTtlCache.cleanup();

            expect(removed).toBe(2);
            expect(shortTtlCache.getStats().size).toBe(1);
            expect(shortTtlCache.get({ key: 'new1', locale: 'en' })).toBe('New 1');
        });

        it('should return 0 when no entries are expired', () => {
            cache.set({ key: 'hello', locale: 'en' }, 'Hello');
            cache.set({ key: 'world', locale: 'en' }, 'World');

            const removed = cache.cleanup();

            expect(removed).toBe(0);
            expect(cache.getStats().size).toBe(2);
        });

        it('should handle empty cache', () => {
            const removed = cache.cleanup();
            expect(removed).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('should handle empty string values', () => {
            cache.set({ key: 'empty', locale: 'en' }, '');
            expect(cache.get({ key: 'empty', locale: 'en' })).toBe('');
            expect(cache.has({ key: 'empty', locale: 'en' })).toBe(true);
        });

        it('should handle keys with special characters', () => {
            cache.set({ key: 'user.profile.name', locale: 'en' }, 'Name');
            cache.set({ key: 'user-profile-name', locale: 'en' }, 'Name 2');
            cache.set({ key: 'user_profile_name', locale: 'en' }, 'Name 3');

            expect(cache.get({ key: 'user.profile.name', locale: 'en' })).toBe('Name');
            expect(cache.get({ key: 'user-profile-name', locale: 'en' })).toBe('Name 2');
            expect(cache.get({ key: 'user_profile_name', locale: 'en' })).toBe('Name 3');
        });

        it('should handle locale codes with regions', () => {
            cache.set({ key: 'hello', locale: 'en-US' }, 'Hello (US)');
            cache.set({ key: 'hello', locale: 'en-GB' }, 'Hello (UK)');

            expect(cache.get({ key: 'hello', locale: 'en-US' })).toBe('Hello (US)');
            expect(cache.get({ key: 'hello', locale: 'en-GB' })).toBe('Hello (UK)');
        });

        it('should handle unicode values', () => {
            cache.set({ key: 'greeting', locale: 'ja' }, 'こんにちは');
            cache.set({ key: 'greeting', locale: 'zh' }, '你好');
            cache.set({ key: 'greeting', locale: 'ar' }, 'مرحبا');

            expect(cache.get({ key: 'greeting', locale: 'ja' })).toBe('こんにちは');
            expect(cache.get({ key: 'greeting', locale: 'zh' })).toBe('你好');
            expect(cache.get({ key: 'greeting', locale: 'ar' })).toBe('مرحبا');
        });
    });
});
