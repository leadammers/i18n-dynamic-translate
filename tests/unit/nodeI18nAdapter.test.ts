import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeI18nAdapter } from '@/adapters/nodeI18nAdapter';
import { BackendError } from '@/utils/errors';
import { Backend, TranslationProvider } from '@/types';

// Create mock node-i18n instance
function createMockNodeI18n(overrides = {}) {
    const catalog: Record<string, Record<string, string>> = {
        en: { hello: 'Hello', world: 'World' },
        de: { hello: 'Hallo' },
    };

    return {
        __: vi.fn((phrase: string) => {
            const locale = 'en';
            return catalog[locale]?.[phrase] || phrase;
        }),
        __n: vi.fn((singular: string, plural: string, count: number) => {
            return count === 1 ? singular : plural;
        }),
        getLocale: vi.fn(() => 'en'),
        setLocale: vi.fn(),
        getLocales: vi.fn(() => ['en', 'de', 'fr']),
        getCatalog: vi.fn((locale: string) => catalog[locale] || {}),
        configure: vi.fn(),
        options: {},
        catalog,
        ...overrides,
    };
}

function createMockConfig() {
    return {
        backend: Backend.NODE_I18N,
        i18nInstance: {},
        localesPath: '/locales',
        defaultLanguage: 'en',
        translationProvider: {
            provider: TranslationProvider.LIBRE_TRANSLATE,
        },
    };
}

describe('NodeI18nAdapter', () => {
    let adapter: NodeI18nAdapter;
    let mockNodeI18n: ReturnType<typeof createMockNodeI18n>;
    let mockConfig: ReturnType<typeof createMockConfig>;

    beforeEach(() => {
        adapter = new NodeI18nAdapter();
        mockNodeI18n = createMockNodeI18n();
        mockConfig = createMockConfig();
        mockConfig.i18nInstance = mockNodeI18n;
    });

    describe('initialize', () => {
        it('should initialize with node-i18n instance', () => {
            expect(() => {
                adapter.initialize(mockNodeI18n, mockConfig);
            }).not.toThrow();
        });

        it('should throw BackendError when instance is null', () => {
            expect(() => {
                adapter.initialize(null, mockConfig);
            }).toThrow(BackendError);

            expect(() => {
                adapter.initialize(null, mockConfig);
            }).toThrow('node-i18n instance is required');
        });

        it('should throw BackendError when instance is undefined', () => {
            expect(() => {
                adapter.initialize(undefined, mockConfig);
            }).toThrow(BackendError);
        });

        it('should override __ method', () => {
            const original__ = mockNodeI18n.__;
            adapter.initialize(mockNodeI18n, mockConfig);

            // The __ method should be overridden
            expect(mockNodeI18n.__).not.toBe(original__);
        });

        it('should override __n method', () => {
            const original__n = mockNodeI18n.__n;
            adapter.initialize(mockNodeI18n, mockConfig);

            // The __n method should be overridden
            expect(mockNodeI18n.__n).not.toBe(original__n);
        });
    });

    describe('getTranslation', () => {
        beforeEach(() => {
            adapter.initialize(mockNodeI18n, mockConfig);
        });

        it('should return translation for existing key', () => {
            const result = adapter.getTranslation('hello', 'en');
            expect(result).toBe('Hello');
        });

        it('should return null for missing key', () => {
            const result = adapter.getTranslation('missing', 'en');
            expect(result).toBeNull();
        });

        it('should get translation from correct locale', () => {
            const result = adapter.getTranslation('hello', 'de');
            expect(result).toBe('Hallo');
        });

        it('should temporarily change and restore locale', () => {
            mockNodeI18n.getLocale.mockReturnValue('en');

            adapter.getTranslation('hello', 'de');

            // Should set locale to target, then restore
            expect(mockNodeI18n.setLocale).toHaveBeenCalledWith('de');
            expect(mockNodeI18n.setLocale).toHaveBeenCalledWith('en');
        });

        it('should return null when getCatalog throws', () => {
            mockNodeI18n.getCatalog.mockImplementation(() => {
                throw new Error('Error');
            });

            const result = adapter.getTranslation('hello', 'en');
            expect(result).toBeNull();
        });
    });

    describe('setTranslation', () => {
        beforeEach(() => {
            adapter.initialize(mockNodeI18n, mockConfig);
        });

        it('should add translation to catalog', () => {
            adapter.setTranslation('greeting', 'fr', 'Bonjour');

            expect(mockNodeI18n.catalog['fr']).toBeDefined();
            expect(mockNodeI18n.catalog['fr']['greeting']).toBe('Bonjour');
        });

        it('should update existing catalog', () => {
            adapter.setTranslation('hello', 'en', 'Hi');

            expect(mockNodeI18n.catalog['en']['hello']).toBe('Hi');
        });

        it('should create catalog object if not exists', () => {
            (mockNodeI18n as Record<string, unknown>).catalog = undefined;

            adapter.setTranslation('test', 'es', 'Prueba');

            expect(mockNodeI18n.catalog).toBeDefined();
            expect(mockNodeI18n.catalog['es']['test']).toBe('Prueba');
        });
    });

    describe('onMissingKey', () => {
        beforeEach(() => {
            adapter.initialize(mockNodeI18n, mockConfig);
        });

        it('should call callback when __ returns the key (missing)', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            // Call the overridden __ method with a missing key
            mockNodeI18n.__('missing.key');

            expect(callback).toHaveBeenCalledWith('missing.key', 'en');
        });

        it('should not call callback when translation exists', () => {
            // Reset to get a fresh adapter with proper mock behavior
            const i18n = createMockNodeI18n();
            i18n.__.mockImplementation((phrase: string) => {
                if (phrase === 'hello') return 'Hello';
                return phrase;
            });

            const adapterWithMock = new NodeI18nAdapter();
            adapterWithMock.initialize(i18n, mockConfig);

            const callback = vi.fn();
            adapterWithMock.onMissingKey(callback);

            // Call with an existing key
            i18n.__('hello');

            expect(callback).not.toHaveBeenCalled();
        });

        it('should call callback when __n returns singular (missing)', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            // Call the overridden __n method
            mockNodeI18n.__n('item', 'items', 1);

            expect(callback).toHaveBeenCalledWith('item', 'en');
        });

        it('should call callback when __n returns plural (missing)', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            mockNodeI18n.__n('item', 'items', 5);

            expect(callback).toHaveBeenCalledWith('item', 'en');
        });
    });

    describe('getCurrentLocale', () => {
        it('should return current locale from i18n', () => {
            adapter.initialize(mockNodeI18n, mockConfig);
            mockNodeI18n.getLocale.mockReturnValue('de');

            expect(adapter.getCurrentLocale()).toBe('de');
        });

        it('should return defaultLanguage if locale is not set', () => {
            mockNodeI18n.getLocale.mockReturnValue(null as unknown as string);
            adapter.initialize(mockNodeI18n, mockConfig);

            expect(adapter.getCurrentLocale()).toBe('en');
        });
    });

    describe('getLocales', () => {
        it('should return locales array from i18n', () => {
            adapter.initialize(mockNodeI18n, mockConfig);

            expect(adapter.getLocales()).toEqual(['en', 'de', 'fr']);
        });

        it('should return default language in array if locales not set', () => {
            mockNodeI18n.getLocales.mockReturnValue(null as unknown as string[]);
            adapter.initialize(mockNodeI18n, mockConfig);

            expect(adapter.getLocales()).toEqual(['en']);
        });
    });

    describe('edge cases', () => {
        it('should handle namespace parameter (ignored for node-i18n)', () => {
            adapter.initialize(mockNodeI18n, mockConfig);

            // namespace is ignored for node-i18n but should not cause errors
            const result = adapter.getTranslation('hello', 'en', 'someNamespace');
            expect(result).toBe('Hello');
        });

        it('should preserve original __ behavior', () => {
            // Create a mock that tracks calls to original
            const i18n = createMockNodeI18n();
            i18n.__ = vi.fn((phrase: string) => {
                return phrase === 'hello' ? 'Hello' : phrase;
            });

            const testAdapter = new NodeI18nAdapter();
            testAdapter.initialize(i18n, mockConfig);

            // Call the overridden method
            const result = i18n.__('hello');

            // Original behavior should be preserved
            expect(result).toBe('Hello');
        });

        it('should preserve original __n behavior', () => {
            const i18n = createMockNodeI18n();
            i18n.__n = vi.fn((singular: string, plural: string, count: number) => {
                return count === 1 ? `One ${singular}` : `${count} ${plural}`;
            });

            const testAdapter = new NodeI18nAdapter();
            testAdapter.initialize(i18n, mockConfig);

            const result = i18n.__n('item', 'items', 3);

            expect(result).toBe('3 items');
        });
    });
});
