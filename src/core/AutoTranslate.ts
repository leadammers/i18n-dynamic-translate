/**
 * AutoTranslate - Core Class
 * Main orchestrator for automatic translation functionality
 */

import { AutoTranslateConfig, Backend, BackendAdapter, TranslationCache, TranslationService } from '@/types';
import { createBackendAdapter } from '@/adapters';
import { createTranslationService } from '@/translators';
import { MemoryCache } from '@/utils/cache';
import { convertKeyToText } from '@/utils/keyConverter';
import { appendTranslationToFile, getLocaleFilePath } from '@/utils/fileHandler';
import { ConfigurationError } from '@/utils/errors';
import { Semaphore } from '@/utils/semaphore';
import { FileLock } from '@/utils/fileLock';

/**
 * Pending key info for batch processing
 */
interface PendingKey {
    key: string;
    locale: string;
    namespace?: string;
    sourceText: string;
    callbacks: Array<{ resolve: () => void; reject: (error: Error) => void }>;
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

    // Batch processing state
    private pendingBatch: Map<string, PendingKey> = new Map();
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private batchDebounceMs: number = 50; // Collect keys for 50ms before batch translate

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
        const processingPromise = this.processMissingKeyAsync(key, locale, namespace, queueKey).catch(
            (error) => {
                console.error(`AutoTranslate: Error processing missing key "${key}" for locale "${locale}":`, error);
            }
        );
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
     * Process a missing translation key using batched translation
     * Keys are collected for a short debounce period then translated together
     */
    private async processMissingKey(key: string, locale: string, namespace?: string): Promise<void> {
        // Check cache first
        if (this.cache && this.cache.has(key, locale)) {
            const cachedTranslation = this.cache.get(key, locale);
            if (cachedTranslation) {
                await this.updateTranslation(key, locale, cachedTranslation, namespace);
                return;
            }
        }

        // Get source text (from default language or convert key)
        let sourceText = this.adapter.getTranslation(key, this.config.defaultLanguage, namespace);
        if (!sourceText) {
            sourceText = this.config.keyToText ? this.config.keyToText(key) : convertKeyToText(key);
        }

        // Add to batch queue and wait for batch processing
        return this.addToBatchQueue(key, locale, namespace, sourceText);
    }

    /**
     * Add a key to the batch queue for translation
     * Returns a promise that resolves when the batch is processed
     */
    private addToBatchQueue(
        key: string,
        locale: string,
        namespace: string | undefined,
        sourceText: string
    ): Promise<void> {
        const queueKey = `${locale}:${namespace || ''}:${key}`;

        return new Promise((resolve, reject) => {
            // If already in batch, just add our callback to the list
            const existing = this.pendingBatch.get(queueKey);
            if (existing) {
                existing.callbacks.push({ resolve, reject });
                return;
            }

            // Create new pending entry
            this.pendingBatch.set(queueKey, {
                key,
                locale,
                namespace,
                sourceText,
                callbacks: [{ resolve, reject }],
            });

            // Reset the debounce timer
            if (this.batchTimer) {
                clearTimeout(this.batchTimer);
            }

            this.batchTimer = setTimeout(() => {
                this.processBatch();
            }, this.batchDebounceMs);
        });
    }

    /**
     * Process all pending keys in a single batch
     */
    private async processBatch(): Promise<void> {
        if (this.pendingBatch.size === 0) return;

        // Take snapshot of current batch and clear it
        const batch = new Map(this.pendingBatch);
        this.pendingBatch.clear();
        this.batchTimer = null;

        // Group by locale for efficient batch translation
        const byLocale = new Map<string, PendingKey[]>();
        for (const pending of batch.values()) {
            if (!byLocale.has(pending.locale)) {
                byLocale.set(pending.locale, []);
            }
            byLocale.get(pending.locale)!.push(pending);
        }

        // Process each locale group
        const localePromises = Array.from(byLocale.entries()).map(async ([locale, keys]) => {
            await this.semaphore.acquire();

            try {
                const sourceTexts = keys.map((k) => k.sourceText);

                // Single batch API call for all keys in this locale
                const translations = await this.translationService.translateBatch(
                    sourceTexts,
                    this.config.defaultLanguage,
                    locale
                );

                // Update all translations in parallel
                const updatePromises = keys.map(async (pending, index) => {
                    const translation = translations[index];

                    try {
                        await this.updateTranslation(pending.key, pending.locale, translation, pending.namespace);

                        if (this.cache) {
                            this.cache.set(pending.key, pending.locale, translation);
                        }

                        // Resolve all callbacks for this key
                        for (const cb of pending.callbacks) {
                            cb.resolve();
                        }
                    } catch (error) {
                        // Reject all callbacks for this key
                        for (const cb of pending.callbacks) {
                            cb.reject(error as Error);
                        }
                    }
                });

                await Promise.all(updatePromises);
            } catch (error) {
                // Reject all pending keys for this locale
                for (const pending of keys) {
                    for (const cb of pending.callbacks) {
                        cb.reject(error as Error);
                    }
                }
                console.error(`AutoTranslate: Batch translation failed for locale ${locale}:`, error);
            } finally {
                this.semaphore.release();
            }
        });

        await Promise.all(localePromises);
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
        const targetKey = parentKey ? `${parentKey}.${key}` : key;
        this.adapter.setTranslation(targetKey, locale, value, namespace);

        // Save to file if autoSave is enabled
        if (this.config.autoSave) {
            // check if namespace is provided when using i18next backend
            const ns = namespace || this.config.defaultNamespace;
            if (!ns && this.config.backend === Backend.I18NEXT) {
                throw new ConfigurationError('Namespace must be provided when using i18next backend');
            }

            const filePath = await getLocaleFilePath(this.config.localesPath, locale, namespace, this.config.fileFormat);

            // Use file lock to prevent concurrent writes
            await this.fileLock.withLock(filePath, async () => {
                try {
                    await appendTranslationToFile(filePath, key, value, this.config.fileFormat, parentKey);
                } catch (error) {
                    console.error(`AutoTranslate: Failed to save translation to file ${filePath}:`, error);
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
            const cached = this.cache.get(key, targetLocale, context);
            if (cached) return cached;
        }

        // Adjust adapter target key with parentKey if provided
        const targetKey = parentKey ? `${parentKey}.${key}` : key;

        // Check backend
        const existing = this.adapter.getTranslation(targetKey, targetLocale, namespace);
        if (existing) return existing;

        // Get source text
        let sourceText = this.adapter.getTranslation(targetKey, this.config.defaultLanguage, namespace);

        if (!sourceText) {
            sourceText = this.config.keyToText ? this.config.keyToText(key) : convertKeyToText(key);
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
     * @param options.context - Additional context to improve translation accuracy (e.g., 'e-commerce', 'financial')
     */
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

        const { namespace, parentKey, context } = options || {};
        const flattened = this.flattenObject(obj);
        const translations: Record<string, string> = {};

        // Collect keys that need translation, with their source text
        const pendingTranslations: Array<{ key: string; sourceText: string }> = [];

        for (const [key] of Object.entries(flattened)) {
            // Check cache first
            if (this.cache?.has(key, targetLocale, context)) {
                const cached = this.cache.get(key, targetLocale, context);
                if (cached) {
                    translations[key] = cached;
                    continue;
                }
            }

            // Check if translation already exists in backend
            const targetKey = parentKey ? `${parentKey}.${key}` : key;
            const existing = this.adapter.getTranslation(targetKey, targetLocale, namespace);
            if (existing) {
                translations[key] = existing;
                continue;
            }

            // Get source text: try backend first, fall back to flattened value
            const keyToText = this.config.keyToText || convertKeyToText;
            const sourceText =
                this.adapter.getTranslation(targetKey, this.config.defaultLanguage, namespace) || keyToText(key);

            pendingTranslations.push({ key, sourceText });
        }

        // Nothing to translate - return early
        if (pendingTranslations.length === 0) return translations;

        // Translate all pending keys in a single batch
        const sourceTexts = pendingTranslations.map((item) => item.sourceText);
        const translatedValues = await this.translationService.translateBatch(
            sourceTexts,
            this.config.defaultLanguage,
            targetLocale,
            context
        );

        // Build update tasks for parallel execution
        const updateTasks = pendingTranslations.map(({ key }, index) => {
            const translatedValue = translatedValues[index];
            translations[key] = translatedValue;

            if (this.cache) {
                this.cache.set(key, targetLocale, translatedValue, context);
            }

            return this.updateTranslation(key, targetLocale, translatedValue, namespace, parentKey);
        });

        // Run all file updates in parallel (FileLock handles concurrency per file)
        await Promise.all(updateTasks);

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
     * Wait for all pending translations to complete.
     * Useful for testing or ensuring translations are ready before proceeding.
     * @param maxWaitMs - Maximum time to wait in milliseconds (default: 30000)
     * @returns Promise that resolves when all pending translations are done
     * @throws Error if timeout is exceeded
     */
    async waitForPendingTranslations(maxWaitMs: number = 30000): Promise<void> {
        const startTime = Date.now();
        const checkInterval = this.batchDebounceMs + 10;
        const isProcessing = () =>
            this.processingQueue.size > 0 || this.pendingBatch.size > 0 || this.batchTimer !== null;

        while (isProcessing()) {
            // Check for timeout
            if (Date.now() - startTime > maxWaitMs) {
                throw new Error(
                    `waitForPendingTranslations timed out after ${maxWaitMs}ms. ` +
                        `Remaining: ${this.processingQueue.size} in queue, ${this.pendingBatch.size} in batch.`
                );
            }

            // Wait for all items in processingQueue (active translations)
            const pending = Array.from(this.processingQueue.values());
            if (pending.length > 0) {
                await Promise.allSettled(pending);
            }

            // If there's a pending batch timer or items, wait for processing
            if (this.batchTimer !== null || this.pendingBatch.size > 0) {
                // Small delay to let the batch timer fire
                await new Promise((resolve) => setTimeout(resolve, checkInterval));
            }
        }
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

        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Reject any pending batch items
        for (const pending of this.pendingBatch.values()) {
            for (const cb of pending.callbacks) {
                cb.reject(new Error('AutoTranslate instance disposed'));
            }
        }
        this.pendingBatch.clear();

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
