/**
 * AutoTranslate - Core Class
 * Main orchestrator for automatic translation functionality
 */

import { AutoTranslateConfig, BackendAdapter, TranslationService, TranslationCache } from '@/types';
import { createBackendAdapter } from '@/adapters';
import { createTranslationService } from '@/translators';
import { MemoryCache } from '@/utils/cache';
import { convertKeyToText } from '@/utils/keyConverter';
import { getLocaleFilePath, appendTranslationToFile } from '@/utils/fileHandler';
import { ConfigurationError } from '@/utils/errors';

/**
 * Simple semaphore for concurrency control with FIFO ordering
 */
class Semaphore {
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

/**
 * File write lock to prevent concurrent writes to the same file
 */
class FileLock {
    private locks: Map<string, Promise<void>> = new Map();

    async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
        // Wait for any existing lock on this file
        while (this.locks.has(filePath)) {
            await this.locks.get(filePath);
        }

        // Create a new lock
        let releaseLock: () => void;
        const lockPromise = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        this.locks.set(filePath, lockPromise);

        try {
            return await fn();
        } finally {
            this.locks.delete(filePath);
            releaseLock!();
        }
    }
}

export class AutoTranslate {
    private config: AutoTranslateConfig;
    private adapter: BackendAdapter;
    private translationService: TranslationService;
    private cache?: TranslationCache;
    private processingQueue: Map<string, Promise<void>>;
    private semaphore: Semaphore;
    private fileLock: FileLock;
    private disposed: boolean = false;
    private boundMissingKeyHandler: (key: string, locale: string, namespace?: string) => void;

    constructor(config: AutoTranslateConfig) {
        this.validateConfig(config);
        this.config = this.normalizeConfig(config);
        this.processingQueue = new Map();
        this.semaphore = new Semaphore(this.config.maxConcurrency || 5);
        this.fileLock = new FileLock();

        // Initialize cache if enabled
        if (this.config.enableCache) {
            this.cache = new MemoryCache(this.config.cacheTTL, this.config.maxCacheSize);
        }

        // Create backend adapter
        this.adapter = createBackendAdapter(config.backend);
        this.adapter.initialize(config.i18nInstance, this.config);

        // Create translation service
        this.translationService = createTranslationService(config.translationProvider);

        // Validate translation service is available
        if (!this.translationService.isAvailable()) {
            throw new ConfigurationError('Translation service is not properly configured');
        }

        // Setup missing key handler (store bound reference for cleanup)
        this.boundMissingKeyHandler = this.handleMissingKey.bind(this);
        this.adapter.onMissingKey(this.boundMissingKeyHandler);
    }

    /**
     * Validate configuration
     */
    private validateConfig(config: AutoTranslateConfig): void {
        if (!config.backend) {
            throw new ConfigurationError('Backend is required');
        }

        if (!config.i18nInstance) {
            throw new ConfigurationError('i18nInstance is required');
        }

        if (!config.localesPath) {
            throw new ConfigurationError('localesPath is required');
        }

        if (!config.defaultLanguage) {
            throw new ConfigurationError('defaultLanguage is required');
        }

        if (!config.translationProvider) {
            throw new ConfigurationError('translationProvider is required');
        }
    }

    /**
     * Normalize configuration with defaults
     */
    private normalizeConfig(config: AutoTranslateConfig): AutoTranslateConfig {
        return {
            ...config,
            autoSave: config.autoSave ?? true,
            enableCache: config.enableCache ?? true,
            maxConcurrency: config.maxConcurrency ?? 5,
            defaultNamespace: config.defaultNamespace || 'translation',
        };
    }

    /**
     * Handle missing translation key
     */
    private handleMissingKey(key: string, locale: string, namespace?: string): void {
        // Skip if disposed
        if (this.disposed) {
            return;
        }

        // Skip if same as default language
        if (locale === this.config.defaultLanguage) {
            return;
        }

        // Create unique queue key
        const queueKey = `${locale}:${namespace || ''}:${key}`;

        // If already processing, wait for existing promise (fire and forget)
        const existingPromise = this.processingQueue.get(queueKey);
        if (existingPromise) {
            // Already being processed, no need to start another
            return;
        }

        // Create new processing promise
        const processingPromise = this.processMissingKeyAsync(key, locale, namespace, queueKey);
        this.processingQueue.set(queueKey, processingPromise);
    }

    /**
     * Process a missing translation key asynchronously
     */
    private async processMissingKeyAsync(
        key: string,
        locale: string,
        namespace: string | undefined,
        queueKey: string
    ): Promise<void> {
        try {
            await this.processMissingKey(key, locale, namespace);
        } finally {
            this.processingQueue.delete(queueKey);
        }
    }

    /**
     * Process a missing translation key
     */
    private async processMissingKey(key: string, locale: string, namespace?: string): Promise<void> {
        // Acquire semaphore slot
        await this.semaphore.acquire();

        try {
            // Check cache first
            if (this.cache && this.cache.has(key, locale)) {
                const cachedTranslation = this.cache.get(key, locale);
                if (cachedTranslation) {
                    await this.updateTranslation(key, locale, cachedTranslation, namespace);
                    return;
                }
            }

            // Check if translation exists in backend
            const existing = this.adapter.getTranslation(key, locale, namespace);
            if (existing) {
                return;
            }

            // Get source text (from default language or convert key)
            let sourceText = this.adapter.getTranslation(key, this.config.defaultLanguage, namespace);

            if (!sourceText) {
                // Convert key to readable text
                sourceText = convertKeyToText(key);
            }

            // Translate
            const translation = await this.translationService.translate(
                sourceText,
                this.config.defaultLanguage,
                locale
            );

            // Update translation
            await this.updateTranslation(key, locale, translation, namespace);

            // Cache the translation
            if (this.cache) {
                this.cache.set(key, locale, translation);
            }
        } catch (error) {
            console.error(`AutoTranslate: Failed to translate key "${key}" to ${locale}:`, error);
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * Update translation in backend and file
     */
    private async updateTranslation(
        key: string,
        locale: string,
        value: string,
        namespace?: string,
        parentKey?: string
    ): Promise<void> {
        // Update in backend
        this.adapter.setTranslation(key, locale, value, namespace);

        // Save to file if autoSave is enabled
        if (this.config.autoSave) {
            // check if namespace is provided when using i18next backend
            const ns = namespace || this.config.defaultNamespace;
            if (!ns && this.config.backend === 'i18next') {
                throw new ConfigurationError('Namespace must be provided when using i18next backend');
            }

            const filePath = getLocaleFilePath(this.config.localesPath, locale, namespace, this.config.fileFormat);

            // Use file lock to prevent concurrent writes
            await this.fileLock.withLock(filePath, async () => {
                const result = await appendTranslationToFile(filePath, key, value, this.config.fileFormat, parentKey);

                if (!result.success) {
                    console.error(`AutoTranslate: Failed to save translation to file ${filePath}:`, result.error);
                }
            });
        }
    }

    /**
     * Manually translate a key
     * @param key - Translation key to translate
     * @param targetLocale - Target locale code (e.g., 'de', 'fr', 'es')
     * @param options - Optional translation settings
     * @param options.namespace - i18next namespace (affects file path, e.g., 'common', 'errors')
     * @param options.parentKey - Nest translation under this key (e.g., 'product.meta')
     * @param options.context - Additional context to improve translation accuracy (e.g., 'e-commerce', 'financial')
     * @returns The translated string
     */
    async translateKey(
        key: string,
        targetLocale: string,
        options?: {
            namespace?: string;
            parentKey?: string;
            context?: string;
        }
    ): Promise<string> {
        // Input validation
        if (!key) {
            throw new ConfigurationError('Key must be a non-empty string');
        }
        if (!targetLocale) {
            throw new ConfigurationError('Target locale must be a non-empty string');
        }

        // Check if disposed
        if (this.disposed) {
            throw new ConfigurationError('AutoTranslate instance has been disposed');
        }

        const { namespace, parentKey, context } = options || {};

        // Check cache first
        if (this.cache?.has(key, targetLocale, context)) {
            const cached = this.cache?.get(key, targetLocale, context);
            if (cached) return cached;
        }

        // Adjust adapter target key with parentKey if provided
        const targetKey = parentKey ? `${parentKey}.${key}` : key;

        // Check backend
        const existing = this.adapter.getTranslation(targetKey, targetLocale, namespace);
        if (existing) return existing;

        // Get source text
        let sourceText = this.adapter.getTranslation(key, this.config.defaultLanguage, namespace);

        if (!sourceText) {
            sourceText = convertKeyToText(key);
        }

        // Translate
        const translation = await this.translationService.translate(
            sourceText,
            this.config.defaultLanguage,
            targetLocale,
            context
        );

        // Update and cache
        await this.updateTranslation(key, targetLocale, translation, namespace, parentKey);
        if (this.cache) {
            this.cache.set(key, targetLocale, translation, context);
        }

        return translation;
    }

    /**
     * Translate an object's string values to the target locale.
     * Automatically flattens nested objects and creates translations in locale files.
     * @param obj - Object with string values to translate
     * @param targetLocale - Target locale code
     * @param options - Optional translation settings
     * @param options.namespace - i18next namespace (affects file path, e.g., 'common', 'errors')
     * @param options.parentKey - Nest translation under this key (e.g., 'product.meta')
     * @param options.context - Additional context to improve translation accuracy (e.g., 'e-commerce', 'financial')*/
    async translateObject(
        obj: Record<string, unknown>,
        targetLocale: string,
        options?: {
            namespace?: string;
            parentKey?: string;
            context?: string;
        }
    ): Promise<Record<string, string>> {
        if (!obj || typeof obj !== 'object') {
            throw new ConfigurationError('Object must be a non-null object');
        }
        if (!targetLocale) {
            throw new ConfigurationError('Target locale must be a non-empty string');
        }
        if (this.disposed) {
            throw new ConfigurationError('AutoTranslate instance has been disposed');
        }

        const flattened = this.flattenObject(obj);
        const translations: Record<string, string> = {};

        for (const [key] of Object.entries(flattened)) {
            translations[key] = await this.translateKey(key, targetLocale, options);
        }

        return translations;
    }

    /**
     * Flatten a nested object to dot-notation keys
     */
    private flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
        const result: Record<string, string> = {};

        for (const [key, value] of Object.entries(obj)) {
            const newKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'string') {
                result[newKey] = value;
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                Object.assign(result, this.flattenObject(value as Record<string, unknown>, newKey));
            }
        }

        return result;
    }

    /**
     * Clear translation cache
     */
    clearCache(): void {
        if (this.cache) {
            this.cache.clear();
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; keys: string[] } | null {
        if (this.cache && 'getStats' in this.cache) {
            return (this.cache as MemoryCache).getStats();
        }
        return null;
    }

    /**
     * Get configuration
     */
    getConfig(): Readonly<AutoTranslateConfig> {
        return { ...this.config };
    }

    /**
     * Check if instance is disposed
     */
    isDisposed(): boolean {
        return this.disposed;
    }

    /**
     * Dispose of resources and cleanup
     * After calling this, the instance should not be used
     */
    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Clear the processing queue
        this.processingQueue.clear();

        // Clear cache
        if (this.cache) {
            this.cache.clear();
        }

        // Restore original handlers in the adapter
        this.adapter.destroy();
    }
}
