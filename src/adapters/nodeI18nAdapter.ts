/**
 * Node.js i18n Backend Adapter
 * Integrates AutoTranslate with node-i18n
 */

import { BackendAdapter, MissingKeyCallback, AutoTranslateConfig, LocaleData } from '@/types';
import { BackendError } from '@/utils/errors';
import { getNestedValue, getOwnProperty, setNestedValue, setOwnProperty } from '@/utils/objectPath';

// Type for node-i18n instance (minimal interface)
interface NodeI18nInstance {
    __: (phrase: string, ...args: unknown[]) => string;
    __n: (singular: string, plural: string, count: number, ...args: unknown[]) => string;
    getLocale: () => string;
    setLocale: (locale: string) => void;
    getLocales: () => string[];
    // The live registry entry, or `false` for a locale node-i18n never registered.
    // Nested when `objectNotation` is on, flat otherwise — `LocaleData` covers both.
    getCatalog: (locale: string) => LocaleData | false | undefined;
    addLocale: (locale: string) => void;
    configure: (options: Record<string, unknown>) => void;
    options?: Record<string, unknown>;
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

        // Captured after the guard: the closures below outlive the narrowing, so without a
        // local they would each need a non-null assertion.
        const i18n = this.i18n;

        // Store original __ method
        this.original__ = i18n.__.bind(i18n);

        // Override __ method to detect missing keys
        const original__ = this.original__;
        i18n.__ = (phrase: string, ...args: unknown[]) => {
            const locale = i18n.getLocale();
            const translation = original__(phrase, ...args);

            // node-i18n returns the phrase itself when a translation is not found.
            // Limitation: if a translation intentionally equals its key (e.g. "OK" -> "OK"),
            // this will produce a false positive and trigger an unnecessary API call.
            if (translation === phrase && this.missingKeyCallback) {
                // Handle async callback with proper error handling
                Promise.resolve(this.missingKeyCallback(phrase, locale)).catch((error: unknown) => {
                    this.reportError(error as Error, phrase, locale);
                });
            }

            return translation;
        };

        // Also override __n for plural forms
        this.original__n = i18n.__n.bind(i18n);
        const original__n = this.original__n;
        i18n.__n = (singular: string, plural: string, count: number, ...args: unknown[]) => {
            const locale = i18n.getLocale();
            const translation = original__n(singular, plural, count, ...args);

            // Check if translation is missing
            if ((translation === singular || translation === plural) && this.missingKeyCallback) {
                // Handle async callback with proper error handling
                Promise.resolve(this.missingKeyCallback(singular, locale)).catch((error: unknown) => {
                    this.reportError(error as Error, singular, locale);
                });
            }

            return translation;
        };
    }

    /**
     * Report a callback failure through the configured hook, falling back to
     * stderr only when the host application has not provided one.
     */
    private reportError(error: Error, key: string, locale: string): void {
        if (this.config?.onError) {
            this.config.onError(error, key, locale);
            return;
        }

        console.error(`AutoTranslate: Error in missing key callback for "${key}":`, error);
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

            // A catalog under `objectNotation` nests exactly like a locale file, so
            // it is read by the same function that writes it — which is also what
            // keeps the dot walk from following the prototype chain out of the
            // catalog on both sides.
            if (this.config?.objectNotation) {
                return getNestedValue(catalog, key);
            }

            // Flat key lookup
            const translation = getOwnProperty(catalog, key);
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
            const catalogForLocale = this.resolveCatalog(this.i18n, locale);

            // A catalog under `objectNotation` nests exactly like a locale file,
            // down to the null-branch case, so it is written by the same function.
            if (this.config?.objectNotation) {
                setNestedValue(catalogForLocale, key, value);
            } else {
                // Flat key
                setOwnProperty(catalogForLocale, key, value);
            }
        } catch (error) {
            throw new BackendError(
                `Failed to set translation in node-i18n: ${error instanceof Error ? error.message : String(error)}`,
                'node-i18n'
            );
        }
    }

    /**
     * Get the live catalog object node-i18n reads translations out of.
     *
     * There is exactly one way in: `getCatalog(locale)` returns the registry entry
     * itself, so a write into it is what `__()` sees. An instance exposes no
     * catalog property — the registry is closed over inside the constructor — so
     * creating one and writing there produces an object nothing ever reads, which
     * is how every translation through this adapter used to be lost.
     *
     * A locale the instance does not know has no entry, and `getCatalog` answers
     * `false` rather than creating one. `addLocale` is the documented way to add
     * it; it reads `<locale>.json`, which by this point autoSave has usually just
     * written. When even that registers nothing — no file and `updateFiles` off —
     * node-i18n offers no further entrance, and saying so beats dropping the
     * translation in silence.
     */
    private resolveCatalog(i18n: NodeI18nInstance, locale: string): LocaleData {
        if (!i18n.getLocales().includes(locale)) {
            i18n.addLocale(locale);
        }

        // Re-checked rather than trusted: `getCatalog` falls back to a related
        // locale when the requested one is absent, so an unregistered locale would
        // otherwise have its translations written into a neighbour's catalog.
        if (!i18n.getLocales().includes(locale)) {
            throw new BackendError(
                `node-i18n has no catalog for locale "${locale}" and would not register one. ` +
                    `Add it to configure({ locales: [...] }).`,
                'node-i18n'
            );
        }

        const catalog = i18n.getCatalog(locale);
        if (typeof catalog !== 'object' || catalog === null) {
            throw new BackendError(`node-i18n returned no catalog for locale "${locale}"`, 'node-i18n');
        }

        return catalog;
    }

    /**
     * Register callback for missing keys
     */
    onMissingKey(callback: MissingKeyCallback): void {
        this.missingKeyCallback = callback;
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
