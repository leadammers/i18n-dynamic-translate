/**
 * AutoTranslate - Core Class
 * Main orchestrator for automatic translation functionality
 */

import {
    AutoTranslateConfig,
    BackendAdapter,
    CacheStats,
    StorageAdapter,
    TranslationCache,
    TranslationIdentity,
    TranslationService,
} from '@/types';
import { createBackendAdapter } from '@/adapters';
import { createTranslationService } from '@/translators';
import { MemoryCache } from '@/utils/cache';
import { convertKeyToText } from '@/utils/keyConverter';
import { ConfigurationError, TranslationError } from '@/utils/errors';
import { Semaphore } from '@/utils/semaphore';
import { setOwnProperty } from '@/utils/objectPath';
import { FileStorageAdapter } from '@/storage/FileStorageAdapter';

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

/** How long to wait for more missing keys before translating the collected batch */
const BATCH_DEBOUNCE_MS = 50;

/**
 * Hard ceiling on how long a key may sit in the batch queue.
 *
 * Without it, a steady stream of missing keys arriving faster than the debounce
 * window would re-arm the timer forever and the batch would never flush.
 */
const MAX_BATCH_WAIT_MS = 500;

export class AutoTranslate {
    private config: AutoTranslateConfig;
    private adapter: BackendAdapter;
    private translationService: TranslationService;
    private cache?: TranslationCache;
    private memoryCache?: MemoryCache;
    private processingQueue: Map<string, Promise<void>>;
    private readingBackend: boolean = false;
    private semaphore: Semaphore;
    private storageAdapter: StorageAdapter;
    private disposed: boolean = false;
    private boundMissingKeyHandler: (key: string, locale: string, namespace?: string) => void;

    // Batch processing state
    private pendingBatch: Map<string, PendingKey> = new Map();
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private activeBatchPromise: Promise<void> | null = null;
    /** Timestamp after which the current batch must flush regardless of new arrivals */
    private batchDeadline: number | null = null;

    constructor(config: AutoTranslateConfig) {
        this.validateConfig(config);
        this.config = this.normalizeConfig(config);
        this.processingQueue = new Map();
        this.semaphore = new Semaphore(this.config.maxConcurrency || 5);

        // Initialize storage adapter
        this.storageAdapter =
            config.storageAdapter ||
            new FileStorageAdapter({
                localesPath: config.localesPath,
                fileFormat: config.fileFormat,
            });

        // Initialize cache. A caller-supplied cache is taken as the intent to
        // cache, so it does not additionally require enableCache. Only the
        // built-in cache is tracked as memoryCache: that field drives stats and
        // sweeper teardown, neither of which applies to a foreign implementation.
        if (this.config.cache) {
            this.cache = this.config.cache;
        } else if (this.config.enableCache) {
            this.memoryCache = new MemoryCache(this.config.cacheTTL, this.config.maxCacheSize);
            this.cache = this.memoryCache;
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
            defaultNamespace: config.defaultNamespace ?? 'translation',
            mode: config.mode ?? 'development',
        };
    }

    /**
     * Report a non-fatal error through the configured callback.
     * A library should never own the host application's stderr, so `onError`
     * is the single funnel and console output is only the fallback.
     */
    private reportError(error: Error, key: string, locale: string): void {
        if (this.config.onError) {
            this.config.onError(error, key, locale);
            return;
        }

        console.error(`AutoTranslate: Error processing missing key "${key}" for locale "${locale}":`, error);
    }

    /**
     * The identity a translation is cached under.
     *
     * Built from the slot the translation occupies, not from the arguments
     * that addressed it: `parentKey` is a dot path, so parent `product.meta`
     * with key `name` and parent `product` with key `meta.name` are one entry
     * in the backend and in the locale file, and must be one cache entry too.
     */
    private identityFor(
        key: string,
        locale: string,
        namespace?: string,
        parentKey?: string,
        context?: string
    ): TranslationIdentity {
        return { key: this.targetKeyFor(key, parentKey), locale, namespace, context };
    }

    /**
     * The dot path a translation occupies in the backend and the locale file.
     */
    private targetKeyFor(key: string, parentKey?: string): string {
        return parentKey ? `${parentKey}.${key}` : key;
    }

    /**
     * Build the identity under which a missing key is de-duplicated, both in
     * the in-flight {@link processingQueue} and in the pending batch.
     *
     * Same reasoning as {@link identityFor}: a delimiter join is not injective
     * over consumer-supplied values. Namespace `b` with key `c:d` and namespace
     * `b:c` with key `d` would otherwise collapse into one entry, and the
     * second key would never be translated.
     */
    private queueKeyFor(key: string, locale: string, namespace?: string): string {
        return JSON.stringify([locale, namespace ?? '', key]);
    }

    /**
     * Decide whether an automatically detected missing key may be translated.
     *
     * In production mode only explicitly allow-listed namespaces qualify. The
     * node-i18n backend has no namespaces, so there the allow-list entries are
     * matched as dot-separated key prefixes instead.
     */
    private isAutoTranslateAllowed(key: string, namespace?: string): boolean {
        if (this.config.mode !== 'production') {
            return true;
        }

        const allowed = this.config.allowedNamespaces;
        if (!allowed || allowed.length === 0) {
            return false;
        }

        if (namespace) {
            return allowed.includes(namespace);
        }

        return allowed.some((prefix: string) => key === prefix || key.startsWith(`${prefix}.`));
    }

    /**
     * Handle missing translation key
     */
    private handleMissingKey(key: string, locale: string, namespace?: string): void {
        // Skip if disposed
        if (this.disposed) {
            return;
        }

        // A read this library made itself is not an application's missing key
        if (this.readingBackend) {
            return;
        }

        // Skip if same as default language
        if (locale === this.config.defaultLanguage) {
            return;
        }

        if (!this.isAutoTranslateAllowed(key, namespace)) {
            return;
        }

        // Create unique queue key
        const queueKey = this.queueKeyFor(key, locale, namespace);

        // If already processing, wait for existing promise (fire and forget)
        if (this.processingQueue.has(queueKey)) {
            // Already being processed, no need to start another
            return;
        }

        this.startProcessing(key, locale, namespace, queueKey);
    }

    /**
     * Register a missing key as in flight, then process it.
     *
     * The slot is reserved before the work starts rather than after it. Deriving
     * the source text reads the default language out of the backend, and the
     * backend reports that read as another miss — for the *target* locale,
     * because i18next reports a miss against the fallback language rather than
     * the one that was looked up. That re-enters {@link handleMissingKey} for
     * the very key being processed, and a registration that came afterwards
     * would leave the re-entry looking at an empty queue, recursing until the
     * stack ran out.
     *
     * The placeholder stands in only for the two synchronous statements below,
     * which replace it with the real promise before control returns to the event
     * loop — nothing can await the queue in between.
     */
    private startProcessing(key: string, locale: string, namespace: string | undefined, queueKey: string): void {
        this.processingQueue.set(queueKey, Promise.resolve());

        const processingPromise = this.processMissingKey(key, locale, namespace)
            .catch((error: unknown) => this.reportError(error as Error, key, locale))
            .finally(() => {
                this.processingQueue.delete(queueKey);
            });

        this.processingQueue.set(queueKey, processingPromise);
    }

    /**
     * Process a missing translation key using batched translation
     * Keys are collected for a short debounce period then translated together
     */
    private async processMissingKey(key: string, locale: string, namespace?: string): Promise<void> {
        const identity = this.identityFor(key, locale, namespace);

        // Check cache first
        if (this.cache && this.cache.has(identity)) {
            const cachedTranslation = this.cache.get(identity);
            if (cachedTranslation) {
                await this.updateTranslation(key, locale, cachedTranslation, namespace);
                return;
            }
        }

        const sourceText = this.resolveSourceText(key, key, locale === this.config.defaultLanguage, namespace);

        // Add to batch queue and wait for batch processing
        return this.addToBatchQueue(key, locale, namespace, sourceText);
    }

    /**
     * Read a translation out of the backend without the read counting as a miss.
     *
     * A backend reports a failed lookup to its missing-key handler, so every
     * read this library makes to decide what to do next would arrive back as an
     * application miss: the source-language read below would queue the key it
     * was called for, and the existing-translation check in {@link translateKey}
     * would queue a key the caller is already translating. Neither came from the
     * application, so neither is reported. `getTranslation` is synchronous,
     * which is what keeps the flag from spanning anything else.
     */
    private readFromBackend(key: string, locale: string, namespace?: string): string | null {
        this.readingBackend = true;
        try {
            return this.adapter.getTranslation(key, locale, namespace);
        } finally {
            this.readingBackend = false;
        }
    }

    /**
     * Derive the text to send to the translation provider.
     *
     * Preference order: the default language's own translation, then the
     * key rendered as human-readable text.
     *
     * @param key - Translation key, last segment relative to any parentKey
     * @param lookupKey - Full key path used for the backend lookup
     * @param skipBackendLookup - Skip the lookup when the target *is* the source language
     * @param namespace - i18next namespace
     */
    private resolveSourceText(key: string, lookupKey: string, skipBackendLookup: boolean, namespace?: string): string {
        if (!skipBackendLookup) {
            const fromDefaultLanguage = this.readFromBackend(lookupKey, this.config.defaultLanguage, namespace);
            if (fromDefaultLanguage) {
                return fromDefaultLanguage;
            }
        }

        // The hook is documented to receive the last key segment. The missing-key
        // path hands in a full dotted path while the explicit APIs hand in a bare
        // key, so normalise here rather than leaking that difference to callers.
        const keyText = key.split('.').at(-1) ?? key;

        return this.config.keyToText ? this.config.keyToText(keyText) : convertKeyToText(keyText);
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
        const queueKey = this.queueKeyFor(key, locale, namespace);

        return new Promise((resolve: () => void, reject: (error: Error) => void) => {
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

            this.scheduleBatch();
        });
    }

    /**
     * (Re-)arm the debounce timer for the current batch.
     *
     * The timer is pushed back on every arrival so bursts translate together,
     * but never past `batchDeadline` — otherwise a continuous stream of missing
     * keys would starve the batch indefinitely.
     */
    private scheduleBatch(): void {
        const now = Date.now();

        if (this.batchDeadline === null) {
            this.batchDeadline = now + MAX_BATCH_WAIT_MS;
        }

        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        const delay = Math.max(0, Math.min(BATCH_DEBOUNCE_MS, this.batchDeadline - now));

        this.batchTimer = setTimeout(() => {
            this.activeBatchPromise = this.processBatch().finally(() => {
                this.activeBatchPromise = null;
            });
        }, delay);
    }

    /**
     * Process all pending keys in a single batch
     */
    private async processBatch(): Promise<void> {
        this.batchTimer = null;
        this.batchDeadline = null;

        if (this.disposed || this.pendingBatch.size === 0) return;

        // Take snapshot of current batch and clear it
        const batch = new Map(this.pendingBatch);
        this.pendingBatch.clear();

        // Group by locale for efficient batch translation
        const byLocale = new Map<string, PendingKey[]>();
        for (const pending of batch.values()) {
            const forLocale = byLocale.get(pending.locale);
            if (forLocale) {
                forLocale.push(pending);
            } else {
                byLocale.set(pending.locale, [pending]);
            }
        }

        // Process each locale group
        const localePromises = Array.from(byLocale.entries()).map(async ([locale, keys]: [string, PendingKey[]]) => {
            await this.semaphore.acquire();

            try {
                const sourceTexts = keys.map((pending: PendingKey) => pending.sourceText);

                // Single batch API call for all keys in this locale
                const translations = await this.translationService.translateBatch(
                    sourceTexts,
                    this.config.defaultLanguage,
                    locale
                );

                const translated = this.pairWithTranslations(keys, translations);

                // Update all translations in parallel
                const updatePromises = translated.map(async ([pending, translation]: [PendingKey, string]) => {
                    try {
                        await this.updateTranslation(pending.key, pending.locale, translation, pending.namespace);

                        if (this.cache) {
                            this.cache.set(
                                this.identityFor(pending.key, pending.locale, pending.namespace),
                                translation
                            );
                        }

                        // Resolve all callbacks for this key
                        for (const callback of pending.callbacks) {
                            callback.resolve();
                        }
                    } catch (error: unknown) {
                        // Reject all callbacks for this key
                        for (const callback of pending.callbacks) {
                            callback.reject(error as Error);
                        }
                    }
                });

                await Promise.all(updatePromises);
            } catch (error: unknown) {
                // Reject all pending keys for this locale. Reporting stops here on
                // purpose: each rejection travels back through the caller's own
                // `.catch(reportError)`, so reporting the batch as well would hand
                // the consumer the same failure once per key plus once combined.
                for (const pending of keys) {
                    for (const callback of pending.callbacks) {
                        callback.reject(error as Error);
                    }
                }
            } finally {
                this.semaphore.release();
            }
        });

        await Promise.all(localePromises);
    }

    /**
     * Zip each request with its translation, rejecting a batch that does not line
     * up with the request. Both shapes below would otherwise be persisted as
     * `undefined`: too few entries, or the right count with a malformed entry
     * inside it (a DeepL response of `{ translations: [{}] }` maps to `[undefined]`).
     *
     * Pairing rather than asserting is what keeps the two lists in step: the
     * positional correspondence is still the invariant, but it is established and
     * checked here once instead of at every call site.
     */
    private pairWithTranslations<TRequest>(requests: TRequest[], translations: string[]): [TRequest, string][] {
        if (translations.length !== requests.length) {
            throw new TranslationError(
                `Translation provider returned ${translations.length} translations for ${requests.length} requested texts`
            );
        }

        return requests.map((request: TRequest, index: number): [TRequest, string] => {
            const translation = translations[index];
            if (typeof translation !== 'string') {
                throw new TranslationError(`Translation provider returned a non-string translation at index ${index}`);
            }

            return [request, translation];
        });
    }

    /**
     * Update translation in backend and storage
     */
    private async updateTranslation(
        key: string,
        locale: string,
        value: string,
        namespace?: string,
        parentKey?: string
    ): Promise<void> {
        // Update in backend
        this.writeToBackend(key, locale, value, namespace, parentKey);

        // Persist to storage if autoSave is enabled
        if (this.config.autoSave) {
            await this.storageAdapter.save(locale, key, value, {
                namespace,
                parentKey,
            });
        }
    }

    /**
     * Hand a translation to the backend, reporting a refusal rather than raising it.
     *
     * A backend can decline a write it cannot make — node-i18n has no entrance for a
     * locale it was never configured with. That is worth telling the consumer about,
     * but it must not take the rest of the call with it: the provider has already
     * been called and paid for, and the file write that follows is what makes the
     * translation survive a restart. Throwing here would lose the translation from
     * disk and from the cache as well, leaving every later lookup to buy it again.
     */
    private writeToBackend(key: string, locale: string, value: string, namespace?: string, parentKey?: string): void {
        const targetKey = this.targetKeyFor(key, parentKey);

        try {
            this.adapter.setTranslation(targetKey, locale, value, namespace);
        } catch (error: unknown) {
            this.reportError(error as Error, targetKey, locale);
        }
    }

    /**
     * Manually translate a key
     * @param key - Translation key to translate
     * @param targetLocale - Target locale code (e.g., 'de', 'fr', 'es')
     * @param options - Optional translation settings
     * @param options.namespace - i18next namespace (affects file path, e.g., 'common', 'errors')
     * @param options.parentKey - Nest translation under this key (e.g., 'product.meta')
     * @param options.context - Additional context to improve translation accuracy (e.g., 'e-commerce').
     *                          DeepL only — LibreTranslate has no context parameter and ignores it.
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
        const identity = this.identityFor(key, targetLocale, namespace, parentKey, context);

        // Check cache first
        if (this.cache?.has(identity)) {
            const cached = this.cache.get(identity);
            if (cached) return cached;
        }

        // Adjust adapter target key with parentKey if provided
        const targetKey = this.targetKeyFor(key, parentKey);

        // Check backend
        const existing = this.readFromBackend(targetKey, targetLocale, namespace);
        if (existing) return existing;

        const sourceText = this.resolveSourceText(
            key,
            targetKey,
            targetLocale === this.config.defaultLanguage,
            namespace
        );

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
            this.cache.set(identity, translation);
        }

        return translation;
    }

    /**
     * Translate an object's keys to the target locale.
     *
     * The object's *keys* are what get translated — they are rendered as
     * human-readable labels (`estimatedDelivery` -> "Geschätzte Lieferung") for
     * use in a UI. Nested objects are flattened to dot notation; every leaf key
     * is translated regardless of its value's type.
     *
     * @param obj - Object whose keys should be translated
     * @param targetLocale - Target locale code
     * @param options - Optional translation settings
     * @param options.namespace - i18next namespace (affects file path, e.g., 'common', 'errors')
     * @param options.parentKey - Nest translation under this key (e.g., 'product.meta')
     * @param options.context - Additional context to improve translation accuracy (e.g., 'e-commerce').
     *                          DeepL only — LibreTranslate has no context parameter and ignores it.
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
        const translations: Record<string, string> = {};

        // Collect keys that need translation, with their source text
        const pendingTranslations: Array<{ key: string; sourceText: string }> = [];

        for (const key of this.collectLeafKeys(obj)) {
            const identity = this.identityFor(key, targetLocale, namespace, parentKey, context);

            // Check cache first
            if (this.cache?.has(identity)) {
                const cached = this.cache.get(identity);
                if (cached) {
                    setOwnProperty(translations, key, cached);
                    continue;
                }
            }

            // Check if translation already exists in backend
            const targetKey = this.targetKeyFor(key, parentKey);
            const existing = this.readFromBackend(targetKey, targetLocale, namespace);
            if (existing) {
                setOwnProperty(translations, key, existing);
                continue;
            }

            const sourceText = this.resolveSourceText(
                key,
                targetKey,
                targetLocale === this.config.defaultLanguage,
                namespace
            );

            pendingTranslations.push({ key, sourceText });
        }

        // Nothing to translate - return early
        if (pendingTranslations.length === 0) return translations;

        // Translate all pending keys in a single batch
        const sourceTexts = pendingTranslations.map((item: { key: string; sourceText: string }) => item.sourceText);
        const translatedValues = await this.translationService.translateBatch(
            sourceTexts,
            this.config.defaultLanguage,
            targetLocale,
            context
        );

        const translated = this.pairWithTranslations(pendingTranslations, translatedValues);

        // Update backend for all translated keys
        translated.forEach(([{ key }, translatedValue]: [{ key: string }, string]) => {
            setOwnProperty(translations, key, translatedValue);

            if (this.cache) {
                this.cache.set(this.identityFor(key, targetLocale, namespace, parentKey, context), translatedValue);
            }

            this.writeToBackend(key, targetLocale, translatedValue, namespace, parentKey);
        });

        // Persist to storage
        if (this.config.autoSave) {
            const entries = translated.map(([{ key }, translatedValue]: [{ key: string }, string]) => ({
                locale: targetLocale,
                key,
                value: translatedValue,
                namespace,
                parentKey,
            }));

            if (this.storageAdapter.saveBatch) {
                await this.storageAdapter.saveBatch(entries);
            } else {
                await Promise.all(
                    entries.map((entry) =>
                        this.storageAdapter.save(entry.locale, entry.key, entry.value, {
                            namespace: entry.namespace,
                            parentKey: entry.parentKey,
                        })
                    )
                );
            }
        }

        return translations;
    }

    /**
     * Collect every leaf key of a nested object in dot notation.
     *
     * Only the key paths matter — `translateObject` translates keys, not values —
     * so leaves of any type (string, number, boolean, null, array) are included.
     */
    private collectLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
        const keys: string[] = [];

        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                keys.push(...this.collectLeafKeys(value as Record<string, unknown>, fullKey));
            } else {
                keys.push(fullKey);
            }
        }

        return keys;
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
    getCacheStats(): CacheStats | null {
        return this.cache?.getStats?.() ?? null;
    }

    /**
     * Get a defensive copy of the current configuration.
     *
     * Nested option objects are copied so callers cannot mutate live settings.
     * `i18nInstance` and `storageAdapter` are shared by reference — they are
     * live objects, not configuration values.
     */
    getConfig(): Readonly<AutoTranslateConfig> {
        return {
            ...this.config,
            translationProvider: {
                ...this.config.translationProvider,
                ...(this.config.translationProvider.deeplOptions && {
                    deeplOptions: { ...this.config.translationProvider.deeplOptions },
                }),
            },
            ...(this.config.allowedNamespaces && { allowedNamespaces: [...this.config.allowedNamespaces] }),
        };
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
        const checkInterval = BATCH_DEBOUNCE_MS + 10;
        const isProcessing = (): boolean =>
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
                await new Promise((resolve: (value: unknown) => void) => setTimeout(resolve, checkInterval));
            }
        }
    }

    /**
     * Dispose of resources and cleanup.
     * Waits for in-flight translations to complete before cleaning up.
     * After calling this, the instance should not be used.
     */
    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Clear batch timer first to prevent new batches from starting
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.batchDeadline = null;

        // Reject anything still queued BEFORE awaiting the processing queue.
        // Those queued promises only settle through these callbacks, so awaiting
        // first would deadlock.
        for (const pending of this.pendingBatch.values()) {
            for (const callback of pending.callbacks) {
                callback.reject(new Error('AutoTranslate instance disposed'));
            }
        }
        this.pendingBatch.clear();

        // Wait for in-flight translations and active batch to finish
        const promises: Promise<void>[] = Array.from(this.processingQueue.values());
        if (this.activeBatchPromise) {
            promises.push(this.activeBatchPromise);
        }
        if (promises.length > 0) {
            // Best-effort — allSettled never rejects, so cleanup always continues
            await Promise.allSettled(promises);
        }

        // Clear the processing queue
        this.processingQueue.clear();

        // Clear cache and stop its expiry sweeper
        if (this.memoryCache) {
            this.memoryCache.dispose();
        } else if (this.cache) {
            this.cache.clear();
        }

        // Restore original handlers in the adapter
        this.adapter.destroy();
    }
}
