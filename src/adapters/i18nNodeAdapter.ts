/**
 * i18n-node Backend Adapter
 * Integrates AutoTranslate with i18n-node
 */

import { BackendAdapter, MissingKeyCallback, AutoTranslateConfig, LocaleData } from '@/types';
import { BackendError } from '@/utils/errors';
import { getNestedValue, getOwnProperty, setNestedValue, setOwnProperty } from '@/utils/objectPath';

// Type for an i18n-node instance (minimal interface)
interface I18nNodeInstance {
    __: (phrase: string, ...args: unknown[]) => string;
    __n: (singular: string, plural: string, count: number, ...args: unknown[]) => string;
    getLocale: () => string;
    setLocale: (locale: string) => void;
    getLocales: () => string[];
    // The live registry entry, or `false` for a locale i18n-node never registered.
    // Nested when `objectNotation` is on, flat otherwise — `LocaleData` covers both.
    getCatalog: (locale: string) => LocaleData | false | undefined;
    addLocale: (locale: string) => void;
    configure: (options: Record<string, unknown>) => void;
    options?: Record<string, unknown>;
}

export class I18nNodeAdapter implements BackendAdapter {
    private i18n?: I18nNodeInstance;
    private config?: AutoTranslateConfig;
    private missingKeyCallback?: MissingKeyCallback;
    private initialized: boolean = false;
    private original__?: (phrase: string, ...args: unknown[]) => string;
    private original__n?: (singular: string, plural: string, count: number, ...args: unknown[]) => string;

    /**
     * Initialize the adapter with an i18n-node instance
     */
    initialize(instance: unknown, config: AutoTranslateConfig): void {
        if (!instance) {
            throw new BackendError('i18n-node instance is required', 'i18n-node');
        }

        // Prevent double initialization (method override stacking)
        if (this.initialized) {
            return;
        }

        this.i18n = instance as I18nNodeInstance;
        this.config = config;
        this.initialized = true;

        // Hook into the i18n-node missing key handler
        this.setupMissingKeyHandler();
    }

    /**
     * Setup missing key handler for i18n-node
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

            // i18n-node returns the phrase itself when a translation is not found.
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
     * Get a translation from i18n-node
     */
    getTranslation(key: string, locale: string, _namespace?: string): string | null {
        if (!this.i18n) {
            return null;
        }

        try {
            // Same guard as the write path, for the same reason: `getCatalog` falls
            // back to a related locale, and resolves `__proto__` to `Object.prototype`
            // and `constructor` to `Object`. Without this, a lookup for an
            // unregistered locale answers with a neighbour's translation, or with an
            // inherited member, as though it were this locale's own.
            if (!this.i18n.getLocales().includes(locale)) {
                return null;
            }

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
     * Set a translation in i18n-node
     */
    setTranslation(key: string, locale: string, value: string, _namespace?: string): void {
        if (!this.i18n) {
            throw new BackendError('i18n-node adapter not initialized', 'i18n-node');
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
            // An error raised here already says what went wrong and where; wrapping
            // it again only stutters the prefix into the message.
            if (error instanceof BackendError) {
                throw error;
            }

            throw new BackendError(
                `Failed to set translation in i18n-node: ${error instanceof Error ? error.message : String(error)}`,
                'i18n-node'
            );
        }
    }

    /**
     * Get the live catalog object i18n-node reads translations out of.
     *
     * There is exactly one way in: `getCatalog(locale)` returns the registry entry
     * itself, so a write into it is what `__()` sees. An instance exposes no
     * catalog property — the registry is closed over inside the constructor — so
     * creating one and writing there produces an object nothing ever reads, which
     * is how every translation through this adapter used to be lost.
     *
     * A locale the instance does not know has no entry, and `getCatalog` answers
     * `false` rather than creating one. `addLocale` is the documented way to add
     * it, and it registers the locale only if it can read `<locale>.json` or
     * `updateFiles` lets it create one — this runs before autoSave writes, so on
     * the first key of a new locale that file does not exist yet. When nothing
     * registers, i18n-node offers no further entrance, and saying so beats
     * dropping the translation in silence.
     */
    private resolveCatalog(i18n: I18nNodeInstance, locale: string): LocaleData {
        // `getCatalog('')` hands back the whole registry rather than one entry, so
        // an empty locale would write a key straight into i18n-node's locale map.
        if (!locale) {
            throw new BackendError('i18n-node locale must be a non-empty string', 'i18n-node');
        }

        if (!i18n.getLocales().includes(locale)) {
            i18n.addLocale(locale);
        }

        // Re-checked rather than trusted: `getCatalog` falls back to a related
        // locale when the requested one is absent, so an unregistered locale would
        // otherwise have its translations written into a neighbour's catalog.
        if (!i18n.getLocales().includes(locale)) {
            throw new BackendError(
                `i18n-node has no catalog for locale "${locale}" and would not register one. ` +
                    `Add it to configure({ locales: [...] }).`,
                'i18n-node'
            );
        }

        const catalog = i18n.getCatalog(locale);
        if (typeof catalog !== 'object' || catalog === null) {
            throw new BackendError(`i18n-node returned no catalog for locale "${locale}"`, 'i18n-node');
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
            delete this.original__;
        }

        // Restore original __n method
        if (this.original__n) {
            this.i18n.__n = this.original__n;
            delete this.original__n;
        }

        delete this.missingKeyCallback;

        // Released last, after the restores above have used it. A disposed adapter has to answer
        // exactly as an un-initialized one, and the `!this.i18n` guards in `getTranslation()` and
        // `setTranslation()` are what say so — they only fire once the reference is gone
        // (docs/conventions/concurrency.md: after teardown, reject further work explicitly).
        // `config` deliberately stays: a missing-key callback already in flight can still reject
        // after teardown, and that failure belongs in the consumer's `onError` hook rather than
        // on the console.
        delete this.i18n;
        this.initialized = false;
    }
}
