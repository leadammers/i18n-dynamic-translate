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
            cache.set('hello', 'en', 'Hello');
            expect(cache.get('hello', 'en')).toBe('Hello');
        });

        it('should store values for different locales separately', () => {
            cache.set('hello', 'en', 'Hello');
            cache.set('hello', 'de', 'Hallo');
            cache.set('hello', 'fr', 'Bonjour');

            expect(cache.get('hello', 'en')).toBe('Hello');
            expect(cache.get('hello', 'de')).toBe('Hallo');
            expect(cache.get('hello', 'fr')).toBe('Bonjour');
        });

        it('should store different keys for the same locale', () => {
            cache.set('greeting', 'en', 'Hello');
            cache.set('farewell', 'en', 'Goodbye');

            expect(cache.get('greeting', 'en')).toBe('Hello');
            expect(cache.get('farewell', 'en')).toBe('Goodbye');
        });

        it('should overwrite existing values', () => {
            cache.set('hello', 'en', 'Hello');
            cache.set('hello', 'en', 'Hi');

            expect(cache.get('hello', 'en')).toBe('Hi');
        });

        it('should return null for non-existent keys', () => {
            expect(cache.get('nonexistent', 'en')).toBeNull();
        });

        it('should return null for non-existent locales', () => {
            cache.set('hello', 'en', 'Hello');
            expect(cache.get('hello', 'de')).toBeNull();
        });
    });

    describe('has', () => {
        it('should return true for existing entries', () => {
            cache.set('hello', 'en', 'Hello');
            expect(cache.has('hello', 'en')).toBe(true);
        });

        it('should return false for non-existent keys', () => {
            expect(cache.has('nonexistent', 'en')).toBe(false);
        });

        it('should return false for non-existent locales', () => {
            cache.set('hello', 'en', 'Hello');
            expect(cache.has('hello', 'de')).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            cache.set('hello', 'en', 'Hello');
            cache.set('world', 'en', 'World');
            cache.set('hello', 'de', 'Hallo');

            cache.clear();

            expect(cache.get('hello', 'en')).toBeNull();
            expect(cache.get('world', 'en')).toBeNull();
            expect(cache.get('hello', 'de')).toBeNull();
        });

        it('should reset cache size to 0', () => {
            cache.set('hello', 'en', 'Hello');
            cache.set('world', 'en', 'World');

            cache.clear();

            expect(cache.getStats().size).toBe(0);
        });
    });

    describe('getStats', () => {
        it('should return correct size', () => {
            expect(cache.getStats().size).toBe(0);

            cache.set('hello', 'en', 'Hello');
            expect(cache.getStats().size).toBe(1);

            cache.set('world', 'en', 'World');
            expect(cache.getStats().size).toBe(2);

            cache.set('hello', 'de', 'Hallo');
            expect(cache.getStats().size).toBe(3);
        });

        it('should return all cache keys', () => {
            cache.set('hello', 'en', 'Hello');
            cache.set('world', 'de', 'Welt');

            const stats = cache.getStats();
            expect(stats.keys).toContain('["en","hello",null]');
            expect(stats.keys).toContain('["de","world",null]');
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
            shortTtlCache.set('hello', 'en', 'Hello');

            expect(shortTtlCache.get('hello', 'en')).toBe('Hello');

            // Advance time past TTL
            vi.advanceTimersByTime(1001);

            expect(shortTtlCache.get('hello', 'en')).toBeNull();
        });

        it('should return false for expired entries on has', () => {
            const shortTtlCache = new MemoryCache(1000);
            shortTtlCache.set('hello', 'en', 'Hello');

            expect(shortTtlCache.has('hello', 'en')).toBe(true);

            vi.advanceTimersByTime(1001);

            expect(shortTtlCache.has('hello', 'en')).toBe(false);
        });

        it('should not expire entries within TTL', () => {
            const shortTtlCache = new MemoryCache(1000);
            shortTtlCache.set('hello', 'en', 'Hello');

            vi.advanceTimersByTime(500);

            expect(shortTtlCache.get('hello', 'en')).toBe('Hello');
            expect(shortTtlCache.has('hello', 'en')).toBe(true);
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

            shortTtlCache.set('old1', 'en', 'Old 1');
            shortTtlCache.set('old2', 'en', 'Old 2');

            vi.advanceTimersByTime(1500);

            shortTtlCache.set('new1', 'en', 'New 1');

            const removed = shortTtlCache.cleanup();

            expect(removed).toBe(2);
            expect(shortTtlCache.getStats().size).toBe(1);
            expect(shortTtlCache.get('new1', 'en')).toBe('New 1');
        });

        it('should return 0 when no entries are expired', () => {
            cache.set('hello', 'en', 'Hello');
            cache.set('world', 'en', 'World');

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
            cache.set('empty', 'en', '');
            expect(cache.get('empty', 'en')).toBe('');
            expect(cache.has('empty', 'en')).toBe(true);
        });

        it('should handle keys with special characters', () => {
            cache.set('user.profile.name', 'en', 'Name');
            cache.set('user-profile-name', 'en', 'Name 2');
            cache.set('user_profile_name', 'en', 'Name 3');

            expect(cache.get('user.profile.name', 'en')).toBe('Name');
            expect(cache.get('user-profile-name', 'en')).toBe('Name 2');
            expect(cache.get('user_profile_name', 'en')).toBe('Name 3');
        });

        it('should handle locale codes with regions', () => {
            cache.set('hello', 'en-US', 'Hello (US)');
            cache.set('hello', 'en-GB', 'Hello (UK)');

            expect(cache.get('hello', 'en-US')).toBe('Hello (US)');
            expect(cache.get('hello', 'en-GB')).toBe('Hello (UK)');
        });

        it('should handle unicode values', () => {
            cache.set('greeting', 'ja', 'こんにちは');
            cache.set('greeting', 'zh', '你好');
            cache.set('greeting', 'ar', 'مرحبا');

            expect(cache.get('greeting', 'ja')).toBe('こんにちは');
            expect(cache.get('greeting', 'zh')).toBe('你好');
            expect(cache.get('greeting', 'ar')).toBe('مرحبا');
        });
    });
});
