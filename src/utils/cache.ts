/**
 * Translation Cache
 * In-memory caching for translations to avoid redundant API calls
 */

import { TranslationCache, CacheEntry } from '@/types';

export class MemoryCache implements TranslationCache {
    private cache: Map<string, CacheEntry>;
    private ttl: number; // Time to live in milliseconds
    private maxSize: number; // Maximum number of entries
    private cleanupInterval: number; // Cleanup interval in milliseconds
    private cleanupTimer?: ReturnType<typeof setInterval>;

    constructor(
        ttl: number = 24 * 60 * 60 * 1000,
        maxSize: number = 1000,
        cleanupInterval: number = 60 * 60 * 1000 // Default: cleanup every hour
    ) {
        this.cache = new Map();
        this.ttl = ttl;
        this.maxSize = maxSize;
        this.cleanupInterval = cleanupInterval;

        // Start automatic cleanup if interval is positive
        if (this.cleanupInterval > 0) {
            this.startAutoCleanup();
        }
    }

    /**
     * Start automatic cleanup interval
     */
    private startAutoCleanup(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);

        // Ensure the timer doesn't prevent Node.js from exiting
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * Stop automatic cleanup interval
     */
    stopAutoCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }

    /**
     * Generate a cache key from translation key, locale and context.
     *
     * JSON rather than a delimiter join: all three components are
     * consumer-supplied, so a separator character can occur inside one. A
     * context of `formal` on key `title` would otherwise share an entry with
     * the context-free key `title:formal`.
     */
    private getCacheKey(key: string, locale: string, context?: string): string {
        return JSON.stringify([locale, key, context ?? null]);
    }

    /**
     * Check if a cache entry is expired
     */
    private isExpired(entry: CacheEntry): boolean {
        return Date.now() - entry.timestamp > this.ttl;
    }

    /**
     * Get a cached translation
     */
    get(key: string, locale: string, context?: string): string | null {
        const cacheKey = this.getCacheKey(key, locale, context);
        const entry = this.cache.get(cacheKey);

        if (!entry) {
            return null;
        }

        if (this.isExpired(entry)) {
            this.cache.delete(cacheKey);
            return null;
        }

        return entry.value;
    }

    /**
     * Set a translation in cache
     */
    set(key: string, locale: string, value: string, context?: string): void {
        const cacheKey = this.getCacheKey(key, locale, context);

        // Evict oldest entry if at capacity (and not updating existing key)
        if (!this.cache.has(cacheKey) && this.cache.size >= this.maxSize) {
            this.evictOldest();
        }

        this.cache.set(cacheKey, {
            value,
            timestamp: Date.now(),
        });
    }

    /**
     * Evict the oldest entry from the cache
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.timestamp < oldestTime) {
                oldestTime = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    /**
     * Check if a translation exists in cache
     */
    has(key: string, locale: string, context?: string): boolean {
        const cacheKey = this.getCacheKey(key, locale, context);
        const entry = this.cache.get(cacheKey);

        if (!entry) {
            return false;
        }

        if (this.isExpired(entry)) {
            this.cache.delete(cacheKey);
            return false;
        }

        return true;
    }

    /**
     * Clear all cached translations.
     *
     * The automatic expiry sweeper keeps running — use {@link dispose} to shut
     * the cache down for good.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Clear all cached translations and stop the automatic expiry sweeper.
     * The cache must not be used after this.
     */
    dispose(): void {
        this.cache.clear();
        this.stopAutoCleanup();
    }

    /**
     * Get cache statistics
     */
    getStats(): { size: number; keys: string[] } {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys()),
        };
    }

    /**
     * Remove expired entries
     */
    cleanup(): number {
        let removed = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (this.isExpired(entry)) {
                this.cache.delete(key);
                removed++;
            }
        }
        return removed;
    }
}
