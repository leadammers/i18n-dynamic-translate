import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoTranslate } from '@/core/AutoTranslate';
import { Backend, StorageAdapter, TranslationCache, TranslationIdentity, TranslationProvider } from '@/types';
import { ConfigurationError } from '@/utils/errors';

// Mock the translators module so translateKey / translateObject don't make real HTTP calls
vi.mock('@/translators', () => ({
    createTranslationService: () => ({
        isAvailable: () => true,
        translate: vi.fn().mockResolvedValue('mocked'),
        translateBatch: vi.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => 'mocked'))),
    }),
}));

// Mock i18next instance
function createMockI18next() {
    return {
        language: 'en',
        languages: ['en', 'de', 'fr'],
        options: {
            ns: ['translation'],
            missingKeyHandler: null as
                | ((lngs: string[], ns: string, key: string, fallbackValue: string) => void)
                | null,
            saveMissing: false,
        },
        getFixedT: vi.fn((_locale: string, _ns: string) => {
            return (key: string) => key; // Return key (simulates missing translation)
        }),
        addResource: vi.fn(),
    };
}

// Mock node-i18n instance
// Mirrors the real `i18n` contract: no `catalog` property, and `getCatalog`
// hands out the live object or `false`. See the note in nodeI18nAdapter.test.ts.
function createMockNodeI18n() {
    const locales: Record<string, Record<string, string>> = {
        en: { hello: 'Hello' },
        de: {},
    };

    return {
        __: vi.fn((phrase: string) => locales['en']?.[phrase] || phrase),
        __n: vi.fn((singular: string) => singular),
        getLocale: vi.fn(() => 'en'),
        setLocale: vi.fn(),
        getLocales: vi.fn(() => Object.keys(locales)),
        getCatalog: vi.fn((locale: string) => locales[locale] ?? false),
        addLocale: vi.fn((locale: string) => {
            locales[locale] ??= {};
        }),
        configure: vi.fn(),
        options: {},
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
            await expect(instance.translateKey('hello', '')).rejects.toThrow(
                'Target locale must be a non-empty string'
            );

            await instance.dispose();
        });
    });

    describe('translateObject validation', () => {
        it('should throw ConfigurationError for null object', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);

            await expect(instance.translateObject(null as never, 'de')).rejects.toThrow(ConfigurationError);
            await expect(instance.translateObject(null as never, 'de')).rejects.toThrow(
                'Object must be a non-null object'
            );

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
            await expect(instance.translateObject({ key: 'value' }, '')).rejects.toThrow(
                'Target locale must be a non-empty string'
            );

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

    describe('production mode', () => {
        it('should default to development mode', async () => {
            const config = createValidConfig(mockI18next);
            const instance = new AutoTranslate(config);
            expect(instance.getConfig().mode).toBe('development');
            await instance.dispose();
        });

        it('should skip missing key handler for non-allowed namespaces in production mode', async () => {
            const config = {
                ...createValidConfig(mockI18next),
                mode: 'production' as const,
                allowedNamespaces: ['products'],
            };
            const instance = new AutoTranslate(config);

            // Trigger missing key handler with a non-allowed namespace
            const handler = mockI18next.options.missingKeyHandler!;
            handler(['de'], 'common', 'some.key', 'some.key');

            // Nothing should be queued
            expect(instance.isDisposed()).toBe(false);
            // No processing should have started — verify by checking the handler doesn't throw
            await instance.dispose();
        });

        it('should allow missing key handler for allowed namespaces in production mode', () => {
            const config = {
                ...createValidConfig(mockI18next),
                mode: 'production' as const,
                allowedNamespaces: ['products'],
            };
            const instance = new AutoTranslate(config);

            // Trigger missing key handler with an allowed namespace
            const handler = mockI18next.options.missingKeyHandler!;

            // This should not throw or be blocked — the key will be queued for processing
            expect(() => handler(['de'], 'products', 'some.key', 'some.key')).not.toThrow();

            // Dispose synchronously — don't await since the queued translation has no mock to resolve
            instance.dispose();
        });

        it('should skip all missing keys in production mode with no allowedNamespaces', async () => {
            const config = {
                ...createValidConfig(mockI18next),
                mode: 'production' as const,
                // No allowedNamespaces configured
            };
            const instance = new AutoTranslate(config);

            const handler = mockI18next.options.missingKeyHandler!;
            handler(['de'], 'products', 'some.key', 'some.key');

            // Should not throw — keys are silently skipped
            await instance.dispose();
        });

        it('should not restrict explicit translateKey calls in production mode', async () => {
            const config = {
                ...createValidConfig(mockI18next),
                mode: 'production' as const,
                allowedNamespaces: ['products'],
            };
            const instance = new AutoTranslate(config);

            // translateKey with a non-allowed namespace should NOT be blocked by mode.
            // Explicit calls always go through regardless of mode/allowedNamespaces.
            const result = await instance.translateKey('hello', 'de', { namespace: 'common' });
            expect(result).toBeDefined();

            await instance.dispose();
        });
    });

    describe('custom storage adapter', () => {
        it('should use custom storageAdapter when provided', async () => {
            const mockAdapter: StorageAdapter = {
                save: vi.fn().mockResolvedValue(undefined),
            };

            const at = new AutoTranslate({
                backend: Backend.I18NEXT,
                i18nInstance: mockI18next,
                localesPath: '/tmp/locales',
                defaultLanguage: 'en',
                translationProvider: {
                    provider: TranslationProvider.DEEPL,
                    apiKey: 'test-key',
                },
                storageAdapter: mockAdapter,
            });

            await at.translateKey('hello', 'de');

            expect(mockAdapter.save).toHaveBeenCalledWith('de', 'hello', 'mocked', {
                namespace: undefined,
                parentKey: undefined,
            });

            at.dispose();
        });

        it('should use saveBatch when storage adapter implements it', async () => {
            const mockAdapter: StorageAdapter = {
                save: vi.fn().mockResolvedValue(undefined),
                saveBatch: vi.fn().mockResolvedValue(undefined),
            };

            const at = new AutoTranslate({
                backend: Backend.I18NEXT,
                i18nInstance: mockI18next,
                localesPath: '/tmp/locales',
                defaultLanguage: 'en',
                translationProvider: {
                    provider: TranslationProvider.DEEPL,
                    apiKey: 'test-key',
                },
                storageAdapter: mockAdapter,
            });

            await at.translateObject({ a: 'A', b: 'B' }, 'de', { parentKey: 'test' });

            expect(mockAdapter.saveBatch).toHaveBeenCalledTimes(1);
            expect(mockAdapter.save).not.toHaveBeenCalled();

            at.dispose();
        });

        it('should not call storage adapter when autoSave is false', async () => {
            const mockAdapter: StorageAdapter = {
                save: vi.fn().mockResolvedValue(undefined),
            };

            const at = new AutoTranslate({
                backend: Backend.I18NEXT,
                i18nInstance: mockI18next,
                localesPath: '/tmp/locales',
                defaultLanguage: 'en',
                translationProvider: {
                    provider: TranslationProvider.DEEPL,
                    apiKey: 'test-key',
                },
                storageAdapter: mockAdapter,
                autoSave: false,
            });

            await at.translateKey('hello', 'de');

            expect(mockAdapter.save).not.toHaveBeenCalled();

            at.dispose();
        });
    });

    describe('custom cache', () => {
        function createRecordingCache(): TranslationCache & { store: Map<string, string> } {
            const store = new Map<string, string>();
            const storageKey = (identity: TranslationIdentity): string =>
                JSON.stringify([identity.locale, identity.namespace ?? '', identity.key, identity.context ?? null]);

            return {
                store,
                get: vi.fn((identity: TranslationIdentity) => store.get(storageKey(identity)) ?? null),
                set: vi.fn((identity: TranslationIdentity, value: string) => {
                    store.set(storageKey(identity), value);
                }),
                has: vi.fn((identity: TranslationIdentity) => store.has(storageKey(identity))),
                clear: vi.fn(() => store.clear()),
                getStats: vi.fn(() => ({ size: store.size })),
            };
        }

        it('routes reads and writes through a caller-supplied cache', async () => {
            const cache = createRecordingCache();
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), cache });

            await at.translateKey('hello', 'de');

            expect(cache.set).toHaveBeenCalled();
            expect(cache.store.size).toBe(1);

            await at.dispose();
        });

        it('caches without enableCache, because supplying a cache is the intent', async () => {
            const cache = createRecordingCache();
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), enableCache: false, cache });

            await at.translateKey('hello', 'de');
            await at.translateKey('hello', 'de');

            // Read through `get`, not `has`: `has` cannot distinguish a cached
            // empty translation from a miss, and the second call has to be served
            // from the cache rather than translated again.
            expect(cache.get).toHaveBeenCalledTimes(2);
            expect(cache.has).not.toHaveBeenCalled();
            expect(cache.set).toHaveBeenCalledTimes(1);

            await at.dispose();
        });

        it('hands the cache a structured identity, not an opaque blob', async () => {
            const cache = createRecordingCache();
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), cache });

            await at.translateKey('name', 'de', { namespace: 'products', parentKey: 'meta', context: 'formal' });

            const [identity] = (cache.set as unknown as { mock: { calls: TranslationIdentity[][] } }).mock.calls[0];
            expect(identity).toEqual({
                key: 'meta.name',
                locale: 'de',
                namespace: 'products',
                context: 'formal',
            });

            await at.dispose();
        });

        // `parentKey` addresses a slot, not an argument: both spellings resolve to the
        // dot path `product.meta.name`, so they must share one entry rather than each
        // paying for its own provider call.
        it('shares one cache entry between two spellings of the same dot path', async () => {
            const cache = createRecordingCache();
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), cache });

            await at.translateKey('name', 'de', { parentKey: 'product.meta' });
            await at.translateKey('meta.name', 'de', { parentKey: 'product' });

            expect(cache.set).toHaveBeenCalledTimes(1);
            expect(cache.store.size).toBe(1);

            await at.dispose();
        });

        it('reports stats through a custom cache that implements getStats', async () => {
            const cache = createRecordingCache();
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), cache });

            await at.translateKey('hello', 'de');

            expect(at.getCacheStats()).toEqual({ size: 1 });

            await at.dispose();
        });

        it('reports null stats for a cache that does not implement getStats', async () => {
            const cache = createRecordingCache();
            delete cache.getStats;
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), cache });

            await at.translateKey('hello', 'de');

            expect(at.getCacheStats()).toBeNull();

            await at.dispose();
        });

        it('clears the supplied cache on dispose without assuming it owns a sweeper', async () => {
            const cache = createRecordingCache();
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), cache });

            await at.dispose();

            expect(cache.clear).toHaveBeenCalled();
        });
    });

    describe('keyToText argument', () => {
        it('receives the last key segment from the missing-key path', async () => {
            const keyToText = vi.fn((key: string) => `text:${key}`);
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), keyToText });

            mockI18next.options.missingKeyHandler?.(['de'], 'translation', 'products.meta.carrier', '');
            await at.waitForPendingTranslations(2000);

            expect(keyToText).toHaveBeenCalledWith('carrier');
            await at.dispose();
        });

        it('receives the same last segment from the explicit API', async () => {
            const keyToText = vi.fn((key: string) => `text:${key}`);
            const at = new AutoTranslate({ ...createValidConfig(mockI18next), keyToText });

            await at.translateKey('carrier', 'de', { parentKey: 'products.meta' });

            expect(keyToText).toHaveBeenCalledWith('carrier');
            await at.dispose();
        });
    });
});
