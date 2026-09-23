/**
 * AutoTranslate Type Definitions
 */

export enum Backend {
    I18NEXT = 'i18next',
    NODE_I18N = 'node-i18n',
}

export enum TranslationProvider {
    LIBRE_TRANSLATE = 'libretranslate',
    DEEPL = 'deepl',
}

export enum FileFormat {
    JSON = 'json',
    YAML = 'yaml',
}

export enum DeepLModelType {
    LATENCY = 'latency_optimized',
    QUALITY = 'prefer_quality_optimized',
}

export type AutoTranslateMode = 'development' | 'production';

/**
 * Main configuration for AutoTranslate
 */
export interface AutoTranslateConfig {
    /** Backend type (i18next or node-i18n) */
    backend: Backend;

    /** Instance of the i18n backend (i18next or node-i18n instance) */
    i18nInstance: unknown; // Use 'unknown' to avoid direct dependency

    /** Path to locale files directory */
    localesPath: string;

    /** Default/source language (e.g., 'en') */
    defaultLanguage: string;

    /** Translation provider configuration */
    translationProvider: TranslationProviderConfig;

    /** Auto-save translated keys to files */
    autoSave?: boolean;

    /** File format for locale files (auto-detected if not specified) */
    fileFormat?: FileFormat;

    /** Default namespace for i18next (optional) */
    defaultNamespace?: string;

    /** Use object notation for nested keys (for node-i18n). Default: false */
    objectNotation?: boolean;

    /** Enable caching of translations */
    enableCache?: boolean;

    /** Maximum concurrent translations */
    maxConcurrency?: number;

    /** Cache time-to-live in milliseconds (default: 24 hours) */
    cacheTTL?: number;

    /** Maximum cache entries (default: 1000) */
    maxCacheSize?: number;

    /**
     * Custom translation cache. Defaults to an in-memory cache honouring
     * `cacheTTL` and `maxCacheSize`, which a custom implementation is free to
     * ignore. Supplying one enables caching regardless of `enableCache`.
     * The instance is owned by the caller: `dispose()` clears it but does not
     * tear down any resources it holds.
     */
    cache?: TranslationCache;

    /** Custom storage adapter. Defaults to FileStorageAdapter when autoSave is true. */
    storageAdapter?: StorageAdapter;

    /**
     * Operating mode. Default: 'development'.
     * - 'development': auto-translate all missing keys across all namespaces
     * - 'production': only auto-translate missing keys within allowedNamespaces
     */
    mode?: AutoTranslateMode;

    /**
     * Namespaces (or parentKey prefixes for node-i18n) that are allowed to be
     * auto-translated in production mode. Ignored in development mode.
     * Missing keys outside these namespaces are silently skipped.
     */
    allowedNamespaces?: string[];

    /**
     * Custom function to convert translation keys to human-readable text
     * for the translation API. Overrides the built-in camelCase/snake_case converter.
     * @param key - The translation key (last segment only, not the full path)
     * @returns Human-readable text to send to the translation provider
     */
    keyToText?: (key: string) => string;

    /**
     * Error callback for the automatic missing-key translation handler.
     * Called when a translation fails in the fire-and-forget path.
     * Defaults to console.error.
     */
    onError?: (error: Error, key: string, locale: string) => void;
}

/**
 * Translation provider configuration
 */
export interface TranslationProviderConfig {
    /** Provider type */
    provider: TranslationProvider;

    /** API key (if required) */
    apiKey?: string;

    /** Custom API URL (for LibreTranslate) */
    apiUrl?: string;

    /** DeepL-specific options */
    deeplOptions?: {
        formality?: 'default' | 'more' | 'less' | 'prefer_more' | 'prefer_less';
        context?: string;
        splitSentences?: '0' | '1' | 'nonewlines';
        modelType?: DeepLModelType;
    };
}

/**
 * Backend adapter interface
 */
export interface BackendAdapter {
    /** Initialize the adapter with the i18n instance */
    initialize(instance: unknown, config: AutoTranslateConfig): void;

    /** Get a translation, return null if missing */
    getTranslation(key: string, locale: string, namespace?: string): string | null;

    /** Set a translation in the backend */
    setTranslation(key: string, locale: string, value: string, namespace?: string): void;

    /** Hook into missing key detection */
    onMissingKey(callback: MissingKeyCallback): void;

    /** Restore original handlers and clean up resources */
    destroy(): void;
}

/**
 * Translation service interface
 */
export interface TranslationService {
    /** Translate text from source to target language */
    translate(text: string, sourceLang: string, targetLang: string, context?: string): Promise<string>;

    /** Translate a batch of texts from source to target language */
    translateBatch(texts: string[], sourceLang: string, targetLang: string, context?: string): Promise<string[]>;

    /** Check if the service is available/configured */
    isAvailable(): boolean;
}

/**
 * Callback for missing translation keys
 */
export type MissingKeyCallback = (key: string, locale: string, namespace?: string) => void | Promise<void>;

/**
 * One stored value plus the timestamp its TTL is measured from.
 *
 * Internal to `MemoryCache` — deliberately not re-exported from `src/index.ts`. A custom
 * `TranslationCache` never has to name it: the interface deals only in identities, strings
 * and `null`.
 */
export interface CacheEntry {
    value: string;
    timestamp: number;
}

/**
 * Everything that identifies one translation.
 *
 * Two lookups with equal identities address the same slot in the backend and
 * in the locale file, and must therefore share a cache entry; two lookups that
 * differ in any field must not. A cache implementation is free to compose its
 * own storage key from these fields — but it has to include all of them, and a
 * delimiter join is not enough, since every field is consumer-supplied and can
 * contain the separator.
 */
export interface TranslationIdentity {
    /**
     * Full dot path of the translation inside its namespace, with any
     * `parentKey` already folded in — `product.meta.name`, not `name`. This is
     * the path the backend and the locale file use.
     */
    key: string;

    /** Target locale, as the backend spells it. */
    locale: string;

    /** Backend namespace, where the backend has namespaces. */
    namespace?: string;

    /** Provider context hint. DeepL only; changes the translation, so it is part of the identity. */
    context?: string;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
    /** Number of entries currently held. */
    size: number;
}

/**
 * Translation cache interface.
 *
 * Implement it to back the `cache` config option with Redis, SQLite or
 * anything else. `getStats()` is optional: without it
 * `AutoTranslate.getCacheStats()` reports `null`.
 */
export interface TranslationCache {
    /** The value, or `null` when the identity is not held. Never `undefined`. */
    get(identity: TranslationIdentity): string | null;

    set(identity: TranslationIdentity, value: string): void;

    /**
     * Optional. The library reads presence through `get()`, because a boolean
     * cannot tell a cached empty translation from a miss, so an implementation
     * only needs this if its own callers want it.
     */
    has?(identity: TranslationIdentity): boolean;

    clear(): void;

    getStats?(): CacheStats;
}

/**
 * Locale file data structure (recursive type for nested translations)
 */
export interface LocaleData {
    [key: string]: string | LocaleData;
}

/**
 * Entry for batch storage operations
 */
export interface StorageSaveEntry {
    locale: string;
    key: string;
    value: string;
    namespace?: string;
    parentKey?: string;
}

/**
 * Storage adapter interface for persisting translations.
 * Write-only — reading translations is handled by the i18n backend adapters.
 */
export interface StorageAdapter {
    /** Save a single translation to storage */
    save(
        locale: string,
        key: string,
        value: string,
        options?: {
            namespace?: string;
            parentKey?: string;
        }
    ): Promise<void>;

    /**
     * Save multiple translations at once.
     * Optional — when not implemented, AutoTranslate calls save() in a loop.
     */
    saveBatch?(entries: StorageSaveEntry[]): Promise<void>;
}
