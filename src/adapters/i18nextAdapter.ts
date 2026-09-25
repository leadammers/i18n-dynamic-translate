/**
 * i18next Backend Adapter
 * Integrates AutoTranslate with i18next
 */

import { BackendAdapter, MissingKeyCallback, AutoTranslateConfig } from '@/types';
import { BackendError } from '@/utils/errors';

// Type for i18next instance (minimal interface)
interface I18nextInstance {
    language?: string;
    languages?: string[];
    options: {
        // `| undefined` on these two is not the usual eOPT widening: a host app really can own
        // either key holding `undefined`, and telling that apart from an absent key is what
        // `setupMissingKeyHandler()` and `destroy()` below are built around.
        missingKeyHandler?: ((lngs: string[], ns: string, key: string, fallbackValue: string) => void) | undefined;
        saveMissing?: boolean | undefined;
        ns?: string[];
    };

    getFixedT(locale: string, ns: string): (key: string) => string;

    addResource(locale: string, ns: string, key: string, value: string): void;
}

export class I18nextAdapter implements BackendAdapter {
    private i18next?: I18nextInstance;
    private config?: AutoTranslateConfig;
    private missingKeyCallback?: MissingKeyCallback;
    private initialized: boolean = false;
    private originalMissingKeyHandler?:
        ((lngs: string[], ns: string, key: string, fallbackValue: string) => void) | undefined;
    private hadMissingKeyHandler: boolean = false;
    private originalSaveMissing?: boolean | undefined;
    private hadSaveMissing: boolean = false;

    /**
     * Initialize the adapter with i18next instance
     */
    initialize(instance: unknown, config: AutoTranslateConfig): void {
        if (!instance) {
            throw new BackendError('i18next instance is required', 'i18next');
        }

        // Prevent double initialization (method override stacking)
        if (this.initialized) {
            return;
        }

        this.i18next = instance as I18nextInstance;
        this.config = config;
        this.initialized = true;

        // Hook into i18next missing key handler
        this.setupMissingKeyHandler();
    }

    /**
     * Setup missing key handler for i18next
     */
    private setupMissingKeyHandler(): void {
        if (!this.i18next) return;

        // Store the original handler and saveMissing setting, recording whether the host's options
        // object *owned* each key rather than what the key held. The two are different states — a
        // host can own `missingKeyHandler` holding `undefined` — and only the ownership answers the
        // question `destroy()` has to ask: put the key back, or take it away again?
        this.hadMissingKeyHandler = 'missingKeyHandler' in this.i18next.options;
        if (this.hadMissingKeyHandler) {
            this.originalMissingKeyHandler = this.i18next.options.missingKeyHandler;
        }

        this.hadSaveMissing = 'saveMissing' in this.i18next.options;
        if (this.hadSaveMissing) {
            this.originalSaveMissing = this.i18next.options.saveMissing;
        }

        this.i18next.options.missingKeyHandler = (lngs: string[], ns: string, key: string, fallbackValue: string) => {
            // Call original handler if it exists
            if (this.originalMissingKeyHandler) {
                this.originalMissingKeyHandler(lngs, ns, key, fallbackValue);
            }

            // Call our callback with bounds checking
            const [locale] = lngs ?? [];
            if (this.missingKeyCallback && locale) {
                // Handle async callback with proper error handling
                Promise.resolve(this.missingKeyCallback(key, locale, ns)).catch((error: unknown) => {
                    this.reportError(error as Error, key, locale);
                });
            }
        };

        // Also set saveMissing to true to trigger the handler
        this.i18next.options.saveMissing = true;
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
     * Get a translation from i18next
     */
    getTranslation(key: string, locale: string, namespace?: string): string | null {
        if (!this.i18next) {
            return null;
        }

        const ns = namespace || this.config?.defaultNamespace || 'translation';

        try {
            const translation = this.i18next.getFixedT(locale, ns)(key);

            // i18next returns the key if translation is missing
            if (translation === key) {
                return null;
            }

            // `getFixedT` is a declared shape over a consumer-supplied object, not a
            // checked one: a `parseMissingKeyHandler` or a `returnedObjectHandler`
            // that answers nothing hands back `undefined`. The core distinguishes a
            // translation from an absent one by `!== null`, so anything that is not
            // a string has to become `null` here or it would be served, written and
            // saved as though it were a translation.
            return typeof translation === 'string' ? translation : null;
        } catch {
            return null;
        }
    }

    /**
     * Set a translation in i18next
     */
    setTranslation(key: string, locale: string, value: string, namespace?: string): void {
        if (!this.i18next) {
            throw new BackendError('i18next adapter not initialized', 'i18next');
        }

        const ns = namespace || this.config?.defaultNamespace || 'translation';

        try {
            // Add resource to i18next store
            this.i18next.addResource(locale, ns, key, value);
        } catch (error) {
            throw new BackendError(
                `Failed to set translation in i18next: ${error instanceof Error ? error.message : String(error)}`,
                'i18next'
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
     * Restore original handlers and clean up resources
     */
    destroy(): void {
        if (!this.initialized || !this.i18next) {
            return;
        }

        // Restore original missingKeyHandler
        if (this.hadMissingKeyHandler) {
            this.i18next.options.missingKeyHandler = this.originalMissingKeyHandler;
        } else {
            delete this.i18next.options.missingKeyHandler;
        }
        delete this.originalMissingKeyHandler;
        this.hadMissingKeyHandler = false;

        // Restore original saveMissing setting
        if (this.hadSaveMissing) {
            this.i18next.options.saveMissing = this.originalSaveMissing;
        } else {
            delete this.i18next.options.saveMissing;
        }
        delete this.originalSaveMissing;
        this.hadSaveMissing = false;

        delete this.missingKeyCallback;
        this.initialized = false;
    }
}
