import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoTranslate } from '@/core/AutoTranslate';
import { Backend, TranslationProvider } from '@/types';
import { ConfigurationError } from '@/utils/errors';

// Mock i18next instance
function createMockI18next() {
    return {
        language: 'en',
        languages: ['en', 'de', 'fr'],
        options: {
            ns: ['translation'],
            missingKeyHandler: null as ((lngs: string[], ns: string, key: string, fallbackValue: string) => void) | null,
            saveMissing: false,
        },
        getFixedT: vi.fn((_locale: string, _ns: string) => {
            return (key: string) => key; // Return key (simulates missing translation)
        }),
        addResource: vi.fn(),
    };
}

// Mock node-i18n instance
function createMockNodeI18n() {
    const catalog: Record<string, Record<string, string>> = {
        en: { hello: 'Hello' },
        de: {},
    };

    return {
        __: vi.fn((phrase: string) => catalog['en']?.[phrase] || phrase),
        __n: vi.fn((singular: string) => singular),
        getLocale: vi.fn(() => 'en'),
        setLocale: vi.fn(),
        getLocales: vi.fn(() => ['en', 'de']),
        getCatalog: vi.fn((locale: string) => catalog[locale] || {}),
        configure: vi.fn(),
        options: {},
        catalog,
    };
}

function createValidConfig(i18nInstance: unknown, backend: Backend = Backend.I18NEXT) {
    return {
        backend,
        i18nInstance,
        localesPath: '/tmp/test-locales',
        defaultLanguage: 'en',
        translationProvider: {
            provider: TranslationProvider.LIBRE_TRANSLATE,
            apiUrl: 'https://libretranslate.com/translate',
        },
        autoSave: false, // Disable file writes for tests
        enableCache: true,
    };
}

describe('AutoTranslate', () => {
    let mockI18next: ReturnType<typeof createMockI18next>;

    beforeEach(() => {
        mockI18next = createMockI18next();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor validation', () => {
        it('should throw ConfigurationError when backend is missing', () => {
            const config = createValidConfig(mockI18next);
            delete (config as Record<string, unknown>).backend;

            expect(() => new AutoTranslate(config as never)).toThrow(ConfigurationError);
            expect(() => new AutoTranslate(config as never)).toThrow('Backend is required');
        });

        it('should throw ConfigurationError when i18nInstance is missing', () => {
            const config = createValidConfig(mockI18next);
            delete (config as Record<string, unknown>).i18nInstance;

            expect(() => new AutoTranslate(config as never)).toThrow(ConfigurationError);
            expect(() => new AutoTranslate(config as never)).toThrow('i18nInstance is required');
        });

        it('should throw ConfigurationError when localesPath is missing', () => {
            const config = createValidConfig(mockI18next);
            delete (config as Record<string, unknown>).localesPath;

            expect(() => new AutoTranslate(config as never)).toThrow(ConfigurationError);
            expect(() => new AutoTranslate(config as never)).toThrow('localesPath is required');
        });

        it('should throw ConfigurationError when defaultLanguage is missing', () => {
            const config = createValidConfig(mockI18next);
            delete (config as Record<string, unknown>).defaultLanguage;

            expect(() => new AutoTranslate(config as never)).toThrow(ConfigurationError);
            expect(() => new AutoTranslate(config as never)).toThrow('defaultLanguage is required');
        });

        it('should throw ConfigurationError when translationProvider is missing', () => {
            const config = createValidConfig(mockI18next);
            delete (config as Record<string, unknown>).translationProvider;

            expect(() => new AutoTranslate(config as never)).toThrow(ConfigurationError);
            expect(() => new AutoTranslate(config as never)).toThrow('translationProvider is required');
        });

        it('should create instance with valid config', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            expect(instance).toBeInstanceOf(AutoTranslate);
            await instance.dispose();
        });
    });

    describe('config normalization', () => {
        it('should apply default values for optional config', async () => {
            const config = createValidConfig(mockI18next);
            delete (config as Record<string, unknown>).autoSave;
            delete (config as Record<string, unknown>).enableCache;

            const instance = new AutoTranslate(config);
            const normalizedConfig = instance.getConfig();

            expect(normalizedConfig.autoSave).toBe(true);
            expect(normalizedConfig.enableCache).toBe(true);
            expect(normalizedConfig.maxConcurrency).toBe(5);
            expect(normalizedConfig.defaultNamespace).toBe('translation');

            await instance.dispose();
        });

        it('should preserve explicit config values', async () => {
            const config = {
                ...createValidConfig(mockI18next),
                autoSave: false,
                enableCache: false,
                maxConcurrency: 10,
                defaultNamespace: 'custom',
            };

            const instance = new AutoTranslate(config);
            const normalizedConfig = instance.getConfig();

            expect(normalizedConfig.autoSave).toBe(false);
            expect(normalizedConfig.enableCache).toBe(false);
            expect(normalizedConfig.maxConcurrency).toBe(10);
            expect(normalizedConfig.defaultNamespace).toBe('custom');

            await instance.dispose();
        });
    });

    describe('dispose', () => {
        it('should mark instance as disposed', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            expect(instance.isDisposed()).toBe(false);

            await instance.dispose();

            expect(instance.isDisposed()).toBe(true);
        });

        it('should be idempotent (safe to call multiple times)', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await instance.dispose();
            await expect(instance.dispose()).resolves.not.toThrow();
            expect(instance.isDisposed()).toBe(true);
        });

        it('should prevent translateKey after dispose', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await instance.dispose();

            await expect(instance.translateKey('hello', 'de')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateKey('hello', 'de')).rejects.toThrow('has been disposed');
        });

        it('should prevent translateObject after dispose', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await instance.dispose();

            await expect(instance.translateObject({ key: 'value' }, 'de')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateObject({ key: 'value' }, 'de')).rejects.toThrow('has been disposed');
        });
    });

    describe('translateKey validation', () => {
        it('should throw ConfigurationError for empty key', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await expect(instance.translateKey('', 'de')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateKey('', 'de')).rejects.toThrow('Key must be a non-empty string');

            await instance.dispose();
        });

        it('should throw ConfigurationError for empty locale', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await expect(instance.translateKey('hello', '')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateKey('hello', '')).rejects.toThrow('Target locale must be a non-empty string');

            await instance.dispose();
        });
    });

    describe('translateObject validation', () => {
        it('should throw ConfigurationError for null object', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await expect(instance.translateObject(null as never, 'de')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateObject(null as never, 'de')).rejects.toThrow('Object must be a non-null object');

            await instance.dispose();
        });

        it('should throw ConfigurationError for non-object', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await expect(instance.translateObject('string' as never, 'de')).rejects.toThrow(ConfigurationError);

            await instance.dispose();
        });

        it('should throw ConfigurationError for empty locale', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await expect(instance.translateObject({ key: 'value' }, '')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateObject({ key: 'value' }, '')).rejects.toThrow('Target locale must be a non-empty string');

            await instance.dispose();
        });
    });

    describe('cache', () => {
        it('should initialize cache when enableCache is true', async () => {
            const config = { ...createValidConfig(mockI18next), enableCache: true };
            const instance = new AutoTranslate(config);

            const stats = instance.getCacheStats();
            expect(stats).not.toBeNull();
            expect(stats?.size).toBe(0);

            await instance.dispose();
        });

        it('should not initialize cache when enableCache is false', async () => {
            const config = { ...createValidConfig(mockI18next), enableCache: false };
            const instance = new AutoTranslate(config);

            const stats = instance.getCacheStats();
            expect(stats).toBeNull();

            await instance.dispose();
        });

        it('should clear cache on clearCache call', async () => {
            const config = { ...createValidConfig(mockI18next), enableCache: true };
            const instance = new AutoTranslate(config);

            // clearCache should not throw even if cache is empty
            expect(() => instance.clearCache()).not.toThrow();

            await instance.dispose();
        });
    });

    describe('getConfig', () => {
        it('should return a copy of the config', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            const returnedConfig = instance.getConfig();

            // Should be a copy, not the same reference
            expect(returnedConfig).not.toBe((instance as unknown as { config: unknown }).config);
            expect(returnedConfig.backend).toBe(Backend.I18NEXT);
            expect(returnedConfig.defaultLanguage).toBe('en');

            await instance.dispose();
        });
    });

    describe('backend integration', () => {
        it('should work with i18next backend', async () => {
            const config = createValidConfig(mockI18next, Backend.I18NEXT);

            expect(() => new AutoTranslate(config)).not.toThrow();
            const instance = new AutoTranslate(config);
            expect(instance.getConfig().backend).toBe(Backend.I18NEXT);

            await instance.dispose();
        });

        it('should work with node-i18n backend', async () => {
            const mockNodeI18n = createMockNodeI18n();
            const config = createValidConfig(mockNodeI18n, Backend.NODE_I18N);

            expect(() => new AutoTranslate(config)).not.toThrow();
            const instance = new AutoTranslate(config);
            expect(instance.getConfig().backend).toBe(Backend.NODE_I18N);

            await instance.dispose();
        });

        it('should setup missing key handler on i18next', async () => {
            const config = createValidConfig(mockI18next, Backend.I18NEXT);
            const instance = new AutoTranslate(config);

            // Verify the missing key handler was set up
            expect(mockI18next.options.saveMissing).toBe(true);
            expect(mockI18next.options.missingKeyHandler).toBeTypeOf('function');

            await instance.dispose();
        });
    });
});