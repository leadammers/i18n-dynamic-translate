/**
 * Node.js i18n Backend Adapter
 * Integrates AutoTranslate with node-i18n
 */

import { BackendAdapter, MissingKeyCallback, AutoTranslateConfig, LocaleData } from '@/types';
import { BackendError } from '@/utils/errors';

// Type for node-i18n instance (minimal interface)
interface NodeI18nInstance {
    __: (phrase: string, ...args: unknown[]) => string;
    __n: (singular: string, plural: string, count: number, ...args: unknown[]) => string;
    getLocale: () => string;
    setLocale: (locale: string) => void;
    getLocales: () => string[];
    getCatalog: (locale: string) => Record<string, string> | undefined;
    configure: (options: Record<string, unknown>) => void;
    options?: Record<string, unknown>;
    catalog?: Record<string, Record<string, string>>;
}

export class NodeI18nAdapter implements BackendAdapter {
    private i18n?: NodeI18nInstance;
    private config?: AutoTranslateConfig;
    private missingKeyCallback?: MissingKeyCallback;
    private initialized: boolean = false;
    private original__?: (phrase: string, ...args: unknown[]) => string;
    private original__n?: (singular: string, plural: string, count: number, ...args: unknown[]) => string;

    /**
     * Initialize the adapter with node-i18n instance
     */
    initialize(instance: unknown, config: AutoTranslateConfig): void {
        if (!instance) {
            throw new BackendError('node-i18n instance is required', 'node-i18n');
        }

        // Prevent double initialization (method override stacking)
        if (this.initialized) {
            return;
        }

        this.i18n = instance as NodeI18nInstance;
        this.config = config;
        this.initialized = true;

        // Hook into node-i18n missing key handler
        this.setupMissingKeyHandler();
    }

    /**
     * Setup missing key handler for node-i18n
     */
    private setupMissingKeyHandler(): void {
        if (!this.i18n) return;

        // Store original __ method
        this.original__ = this.i18n.__.bind(this.i18n);

        // Override __ method to detect missing keys
        const original__ = this.original__;
        this.i18n.__ = (phrase: string, ...args: unknown[]) => {
            const locale = this.i18n!.getLocale();
            const translation = original__(phrase, ...args);

            // node-i18n returns the phrase itself when a translation is not found.
            // Limitation: if a translation intentionally equals its key (e.g. "OK" -> "OK"),
            // this will produce a false positive and trigger an unnecessary API call.
            if (translation === phrase && this.missingKeyCallback) {
                // Handle async callback with proper error handling
                Promise.resolve(this.missingKeyCallback(phrase, locale)).catch((error) => {
                    console.error(`AutoTranslate: Error in missing key callback for "${phrase}":`, error);
                });
            }

            return translation;
        };

        // Also override __n for plural forms
        this.original__n = this.i18n.__n.bind(this.i18n);
        const original__n = this.original__n;
        this.i18n.__n = (singular: string, plural: string, count: number, ...args: unknown[]) => {
            const locale = this.i18n!.getLocale();
            const translation = original__n(singular, plural, count, ...args);

            // Check if translation is missing
            if ((translation === singular || translation === plural) && this.missingKeyCallback) {
                // Handle async callback with proper error handling
                Promise.resolve(this.missingKeyCallback(singular, locale)).catch((error) => {
                    console.error(`AutoTranslate: Error in missing key callback for "${singular}":`, error);
                });
            }

            return translation;
        };
    }

    /**
     * Get a translation from node-i18n
     */
    getTranslation(key: string, locale: string, _namespace?: string): string | null {
        if (!this.i18n) {
            return null;
        }

        try {
            const catalog = this.i18n.getCatalog(locale);
            if (!catalog) return null;

            // If objectNotation is enabled, traverse nested keys
            if (this.config?.objectNotation) {
                const keys = key.split('.');
                let current: LocaleData | string | undefined = catalog;
                for (const k of keys) {
                    if (current && typeof current === 'object' && k in current) {
                        current = current[k];
                    } else {
                        return null;
                    }
                }
                return typeof current === 'string' ? current : null;
            }

            // Flat key lookup
            const translation = catalog[key];
            return typeof translation === 'string' ? translation : null;
        } catch {
            return null;
        }
    }

    /**
     * Set a translation in node-i18n
     */
    setTranslation(key: string, locale: string, value: string, _namespace?: string): void {
        if (!this.i18n) {
            throw new BackendError('node-i18n adapter not initialized', 'node-i18n');
        }

        try {
            // Manually add to catalog (no need to call configure, just update in-memory catalog)
            if (!this.i18n.catalog) {
                this.i18n.catalog = {};
            }
            if (!this.i18n.catalog[locale]) {
                this.i18n.catalog[locale] = {};
            }

            // If objectNotation is enabled, set nested value
            if (this.config?.objectNotation) {
                const keys = key.split('.');
                let current: LocaleData = this.i18n.catalog[locale];
                for (let i = 0; i < keys.length - 1; i++) {
                    const k = keys[i];
                    if (!(k in current) || typeof current[k] !== 'object') {
                        current[k] = {};
                    }
                    current = current[k] as LocaleData;
                }
                current[keys[keys.length - 1]] = value;
            } else {
                // Flat key
                this.i18n.catalog[locale][key] = value;
            }
        } catch (error) {
            throw new BackendError(
                `Failed to set translation in node-i18n: ${error instanceof Error ? error.message : String(error)}`,
                'node-i18n'
            );
        }
    }

    /**
     * Register callback for missing keys
     */
    onMissingKey(callback: MissingKeyCallback): void {
        this.missingKeyCallback = callback;
    }

    /**
     * Get current locale
     */
    getCurrentLocale(): string {
        return this.i18n?.getLocale() || this.config?.defaultLanguage || 'en';
    }

    /**
     * Get available locales
     */
    getLocales(): string[] {
        return this.i18n?.getLocales() || [this.config?.defaultLanguage || 'en'];
    }

    /**
     * Restore original handlers and clean up resources
     */
    destroy(): void {
        if (!this.initialized || !this.i18n) {
            return;
        }

        // Restore original __ method
        if (this.original__) {
            this.i18n.__ = this.original__;
            this.original__ = undefined;
        }

        // Restore original __n method
        if (this.original__n) {
            this.i18n.__n = this.original__n;
            this.original__n = undefined;
        }

        this.missingKeyCallback = undefined;
        this.initialized = false;
    }
}