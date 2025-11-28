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

/**
 * Main configuration for AutoTranslate
 */
export interface AutoTranslateConfig {
    /** Backend type (i18next or node-i18n) */
    backend: Backend;

    /** Instance of the i18n backend (i18next or node-i18n instance) */
    i18nInstance: unknown;

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

    /** Check if the service is available/configured */
    isAvailable(): boolean;
}

/**
 * Callback for missing translation keys
 */
export type MissingKeyCallback = (key: string, locale: string, namespace?: string) => void | Promise<void>;

/**
 * Cache entry structure
 */
export interface CacheEntry {
    value: string;
    timestamp: number;
}

/**
 * Translation cache interface
 */
export interface TranslationCache {
    get(key: string, locale: string, context?: string): string | null;

    set(key: string, locale: string, value: string, context?: string): void;

    clear(): void;

    has(key: string, locale: string, context?: string): boolean;
}

/**
 * File operation result
 */
export interface FileOperationResult {
    success: boolean;
    error?: Error;
}

/**
 * Locale file data structure (recursive type for nested translations)
 */
export interface LocaleData {
    [key: string]: string | LocaleData;
}
