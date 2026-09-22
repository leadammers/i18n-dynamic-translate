import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeI18nAdapter } from '@/adapters/nodeI18nAdapter';
import { BackendError } from '@/utils/errors';
import { Backend, TranslationProvider, LocaleData } from '@/types';

// Create mock node-i18n instance
/**
 * A stand-in for an `i18n` instance that keeps to the real package's contract.
 *
 * Two details matter and are the reason this mock is written out rather than
 * simplified: an `I18n` instance exposes **no** `catalog` property — the registry
 * is closed over inside the constructor and `getCatalog(locale)` is the only way
 * to it — and that call returns the **live** object, or `false` for a locale that
 * was never registered. A mock that offers a `catalog` field, or answers an
 * unknown locale with a fresh `{}`, lets a write that the real package drops on
 * the floor look like it landed.
 */
function createMockNodeI18n(overrides = {}) {
    const locales: Record<string, LocaleData> = {
        en: { hello: 'Hello', world: 'World' },
        de: { hello: 'Hallo' },
    };

    return {
        __: vi.fn((phrase: string) => {
            const locale = 'en';
            const translation = locales[locale]?.[phrase];
            return typeof translation === 'string' ? translation : phrase;
        }),
        __n: vi.fn((singular: string, plural: string, count: number) => {
            return count === 1 ? singular : plural;
        }),
        getLocale: vi.fn(() => 'en'),
        setLocale: vi.fn(),
        getLocales: vi.fn(() => Object.keys(locales)),
        // `false`, not `{}` — an unregistered locale has no catalog to hand out.
        getCatalog: vi.fn((locale: string) => locales[locale] ?? false),
        // The real one reads `<locale>.json`; registering only when that file is
        // there. The mock stands in for the case where it is.
        addLocale: vi.fn((locale: string) => {
            locales[locale] ??= {};
        }),
        configure: vi.fn(),
        options: {},
        ...overrides,
    };
}

/**
 * The only supported way to reach a catalog — `getCatalog` is the real package's
 * sole accessor, and it answers `false` for a locale that was never registered.
 */
function catalogOf(instance: ReturnType<typeof createMockNodeI18n>, locale: string): LocaleData {
    const catalog = instance.getCatalog(locale);
    if (typeof catalog !== 'object') {
        throw new Error(`no catalog registered for "${locale}"`);
    }
    return catalog;
}

/**
 * A stand-in for an instance configured with `fallbacks: { fr: 'de' }`.
 *
 * This is the branch the plain mock models away, and the reason the adapter
 * re-checks `getLocales()` after calling `addLocale`: for an unconfigured locale
 * node-i18n does not answer `false`, it answers with the **fallback's** catalog —
 * the identical object, not a copy. Code that trusts that return value writes
 * French into the German catalog, and autoSave then persists it to `de.json`.
 */
function createMockNodeI18nWithFallback(fallbacks: Record<string, string>) {
    const locales: Record<string, LocaleData> = {
        de: { hallo: 'Hallo' },
    };

    return {
        __: vi.fn((phrase: string) => phrase),
        __n: vi.fn((singular: string) => singular),
        getLocale: vi.fn(() => 'de'),
        setLocale: vi.fn(),
        getLocales: vi.fn((): string[] => Object.keys(locales)),
        getCatalog: vi.fn((locale: string): LocaleData | false => {
            const resolved = fallbacks[locale] ?? locale;
            return locales[resolved] ?? false;
        }),
        // `updateFiles` off and no `<locale>.json`: nothing is registered.
        addLocale: vi.fn(),
        configure: vi.fn(),
        options: {},
        locales,
    };
}

function createMockConfig() {
    return {
        backend: Backend.NODE_I18N,
        i18nInstance: {},
        localesPath: '/locales',
        defaultLanguage: 'en',
        objectNotation: false,
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

        it('should not mutate global locale when reading translations', () => {
            mockNodeI18n.getLocale.mockReturnValue('en');

            adapter.getTranslation('hello', 'de');

            // getCatalog accepts locale directly, no need to switch global state
            expect(mockNodeI18n.setLocale).not.toHaveBeenCalled();
        });

        it("should not read a fallback locale's catalog", () => {
            // `translateKey` returns early on whatever this hands back, so a German
            // string answered for `fr` would be stored and served as the French
            // translation and the provider would never be called.
            const withFallback = createMockNodeI18nWithFallback({ fr: 'de' });
            const fallbackAdapter = new NodeI18nAdapter();
            fallbackAdapter.initialize(withFallback, mockConfig);

            expect(withFallback.getCatalog('fr')).toEqual({ hallo: 'Hallo' });
            expect(fallbackAdapter.getTranslation('hallo', 'fr')).toBeNull();
        });

        it('should return null for a locale node-i18n does not know', () => {
            // Covers `__proto__` and `constructor` too: the real `getCatalog`
            // resolves those to `Object.prototype` and `Object`, so an inherited
            // member would otherwise be returned as though it were a translation.
            expect(adapter.getTranslation('hello', 'zz')).toBeNull();
            expect(adapter.getTranslation('toString', '__proto__')).toBeNull();
            expect(adapter.getTranslation('name', 'constructor')).toBeNull();
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

            expect(catalogOf(mockNodeI18n, 'fr')['greeting']).toBe('Bonjour');
        });

        it('should update existing catalog', () => {
            adapter.setTranslation('hello', 'en', 'Hi');

            expect(catalogOf(mockNodeI18n, 'en')['hello']).toBe('Hi');
        });

        it('should write into the catalog node-i18n itself hands out', () => {
            // The write has to land in the object `getCatalog` returns, because that
            // object *is* node-i18n's registry entry — it is what `__()` reads. A
            // write into any other object is accepted in silence and never shows up.
            const before = catalogOf(mockNodeI18n, 'en');

            adapter.setTranslation('hello', 'en', 'Hi');

            expect(catalogOf(mockNodeI18n, 'en')).toBe(before);
            expect(before['hello']).toBe('Hi');
        });

        it('should register a locale node-i18n has not seen yet', () => {
            adapter.setTranslation('test', 'es', 'Prueba');

            expect(mockNodeI18n.addLocale).toHaveBeenCalledWith('es');
            expect(catalogOf(mockNodeI18n, 'es')['test']).toBe('Prueba');
        });

        it("should not write into a fallback locale's catalog", () => {
            // `getCatalog('fr')` hands back the *German* catalog here. Writing into
            // what it returns would store French under `de` and persist it to
            // `de.json` — which is what the second `getLocales()` check prevents.
            const withFallback = createMockNodeI18nWithFallback({ fr: 'de' });
            const fallbackAdapter = new NodeI18nAdapter();
            fallbackAdapter.initialize(withFallback, mockConfig);

            expect(() => fallbackAdapter.setTranslation('bonjour', 'fr', 'Bonjour')).toThrow(BackendError);
            expect(withFallback.locales['de']).toEqual({ hallo: 'Hallo' });
        });

        it('should refuse an empty locale', () => {
            // `getCatalog('')` returns node-i18n's whole registry rather than one
            // entry, so an empty locale would write a key into the locale map.
            expect(() => adapter.setTranslation('test', '', 'value')).toThrow(BackendError);
        });

        it('should report a refusal without stuttering the prefix', () => {
            const refusing = createMockNodeI18n({ addLocale: vi.fn() });
            const refusingAdapter = new NodeI18nAdapter();
            refusingAdapter.initialize(refusing, mockConfig);

            expect(() => refusingAdapter.setTranslation('test', 'zz', 'Proba')).not.toThrow(
                /Failed to set translation in node-i18n: node-i18n/
            );
        });

        it('should report a locale node-i18n refuses to register', () => {
            // `addLocale` reads `<locale>.json`; with no such file and `updateFiles`
            // off it registers nothing, and there is no other way in. Dropping the
            // translation quietly is what this adapter used to do.
            const refusing = createMockNodeI18n({ addLocale: vi.fn() });
            const refusingAdapter = new NodeI18nAdapter();
            refusingAdapter.initialize(refusing, mockConfig);

            expect(() => refusingAdapter.setTranslation('test', 'zz', 'Proba')).toThrow(BackendError);
        });
    });

    describe('objectNotation', () => {
        // `objectNotation` is the only branch in this adapter that nests, on both
        // the read and the write side, and every other test here runs with it off.
        let nestedCatalog: Record<string, LocaleData>;

        beforeEach(() => {
            nestedCatalog = {
                en: { products: { meta: { carrier: 'Carrier' } } },
            };
            mockNodeI18n.getCatalog.mockImplementation((locale: string) => nestedCatalog[locale] ?? false);
            mockNodeI18n.getLocales.mockImplementation(() => Object.keys(nestedCatalog));
            mockNodeI18n.addLocale.mockImplementation((locale: string) => {
                nestedCatalog[locale] ??= {};
            });
            mockConfig.objectNotation = true;
            adapter.initialize(mockNodeI18n, mockConfig);
        });

        describe('setTranslation', () => {
            it('should create the intermediate branches of a dot path', () => {
                adapter.setTranslation('products.meta.weight', 'de', 'Gewicht');

                expect(nestedCatalog['de']).toEqual({ products: { meta: { weight: 'Gewicht' } } });
            });

            it('should keep a sibling already stored under the same branch', () => {
                adapter.setTranslation('products.meta.weight', 'en', 'Weight');

                expect(nestedCatalog['en']).toEqual({
                    products: { meta: { carrier: 'Carrier', weight: 'Weight' } },
                });
            });
        });

        describe('getTranslation', () => {
            it('should read a value through a dot path', () => {
                expect(adapter.getTranslation('products.meta.carrier', 'en')).toBe('Carrier');
            });

            it('should return null when an intermediate segment is missing', () => {
                expect(adapter.getTranslation('products.missing.carrier', 'en')).toBeNull();
            });

            it('should return null when the path stops on a branch instead of a string', () => {
                expect(adapter.getTranslation('products.meta', 'en')).toBeNull();
            });
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
