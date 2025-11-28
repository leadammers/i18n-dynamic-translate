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
        missingKeyHandler?: (lngs: string[], ns: string, key: string, fallbackValue: string) => void;
        saveMissing?: boolean;
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
    private originalMissingKeyHandler?: (lngs: string[], ns: string, key: string, fallbackValue: string) => void;
    private originalSaveMissing?: boolean;

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

        // Store original handler and saveMissing setting
        this.originalMissingKeyHandler = this.i18next.options.missingKeyHandler;
        this.originalSaveMissing = this.i18next.options.saveMissing;

        this.i18next.options.missingKeyHandler = (lngs: string[], ns: string, key: string, fallbackValue: string) => {
            // Call original handler if it exists
            if (this.originalMissingKeyHandler) {
                this.originalMissingKeyHandler(lngs, ns, key, fallbackValue);
            }

            // Call our callback with bounds checking
            if (this.missingKeyCallback && lngs && lngs.length > 0) {
                const locale = lngs[0];
                // Handle async callback with proper error handling
                Promise.resolve(this.missingKeyCallback(key, locale, ns)).catch((error) => {
                    console.error(`AutoTranslate: Error in missing key callback for "${key}":`, error);
                });
            }
        };

        // Also set saveMissing to true to trigger the handler
        this.i18next.options.saveMissing = true;
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

            return translation;
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
     * Get current language
     */
    getCurrentLanguage(): string {
        return this.i18next?.language || this.config?.defaultLanguage || 'en';
    }

    /**
     * Get available languages
     */
    getLanguages(): string[] {
        return this.i18next?.languages || [this.config?.defaultLanguage || 'en'];
    }

    /**
     * Get namespaces
     */
    getNamespaces(): string[] {
        return this.i18next?.options.ns || ['translation'];
    }

    /**
     * Restore original handlers and clean up resources
     */
    destroy(): void {
        if (!this.initialized || !this.i18next) {
            return;
        }

        // Restore original missingKeyHandler
        this.i18next.options.missingKeyHandler = this.originalMissingKeyHandler;
        this.originalMissingKeyHandler = undefined;

        // Restore original saveMissing setting
        this.i18next.options.saveMissing = this.originalSaveMissing;
        this.originalSaveMissing = undefined;

        this.missingKeyCallback = undefined;
        this.initialized = false;
    }
}