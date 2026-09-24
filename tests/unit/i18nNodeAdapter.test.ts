import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nNodeAdapter } from '@/adapters/i18nNodeAdapter';
import { BackendError } from '@/utils/errors';
import { Backend, TranslationProvider, LocaleData } from '@/types';

// Create mock i18n-node instance
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
function createMockI18nNode(overrides = {}) {
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
function catalogOf(instance: ReturnType<typeof createMockI18nNode>, locale: string): LocaleData {
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
 * i18n-node does not answer `false`, it answers with the **fallback's** catalog —
 * the identical object, not a copy. Code that trusts that return value writes
 * French into the German catalog, and autoSave then persists it to `de.json`.
 */
function createMockI18nNodeWithFallback(fallbacks: Record<string, string>) {
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
        backend: Backend.I18N_NODE,
        i18nInstance: {},
        localesPath: '/locales',
        defaultLanguage: 'en',
        objectNotation: false,
        translationProvider: {
            provider: TranslationProvider.LIBRE_TRANSLATE,
        },
    };
}

describe('I18nNodeAdapter', () => {
    let adapter: I18nNodeAdapter;
    let mockI18nNode: ReturnType<typeof createMockI18nNode>;
    let mockConfig: ReturnType<typeof createMockConfig>;

    beforeEach(() => {
        adapter = new I18nNodeAdapter();
        mockI18nNode = createMockI18nNode();
        mockConfig = createMockConfig();
        mockConfig.i18nInstance = mockI18nNode;
    });

    describe('initialize', () => {
        it('should initialize with i18n-node instance', () => {
            expect(() => {
                adapter.initialize(mockI18nNode, mockConfig);
            }).not.toThrow();
        });

        it('should throw BackendError when instance is null', () => {
            expect(() => {
                adapter.initialize(null, mockConfig);
            }).toThrow(BackendError);

            expect(() => {
                adapter.initialize(null, mockConfig);
            }).toThrow('i18n-node instance is required');
        });

        it('should throw BackendError when instance is undefined', () => {
            expect(() => {
                adapter.initialize(undefined, mockConfig);
            }).toThrow(BackendError);
        });

        it('should override __ method', () => {
            const original__ = mockI18nNode.__;
            adapter.initialize(mockI18nNode, mockConfig);

            // The __ method should be overridden
            expect(mockI18nNode.__).not.toBe(original__);
        });

        it('should override __n method', () => {
            const original__n = mockI18nNode.__n;
            adapter.initialize(mockI18nNode, mockConfig);

            // The __n method should be overridden
            expect(mockI18nNode.__n).not.toBe(original__n);
        });
    });

    describe('getTranslation', () => {
        beforeEach(() => {
            adapter.initialize(mockI18nNode, mockConfig);
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
            mockI18nNode.getLocale.mockReturnValue('en');

            adapter.getTranslation('hello', 'de');

            // getCatalog accepts locale directly, no need to switch global state
            expect(mockI18nNode.setLocale).not.toHaveBeenCalled();
        });

        it("should not read a fallback locale's catalog", () => {
            // `translateKey` returns early on whatever this hands back, so a German
            // string answered for `fr` would be stored and served as the French
            // translation and the provider would never be called.
            const withFallback = createMockI18nNodeWithFallback({ fr: 'de' });
            const fallbackAdapter = new I18nNodeAdapter();
            fallbackAdapter.initialize(withFallback, mockConfig);

            expect(withFallback.getCatalog('fr')).toEqual({ hallo: 'Hallo' });
            expect(fallbackAdapter.getTranslation('hallo', 'fr')).toBeNull();
        });

        it('should return null for a locale i18n-node does not know', () => {
            // Covers `__proto__` and `constructor` too: the real `getCatalog`
            // resolves those to `Object.prototype` and `Object`, so an inherited
            // member would otherwise be returned as though it were a translation.
            expect(adapter.getTranslation('hello', 'zz')).toBeNull();
            expect(adapter.getTranslation('toString', '__proto__')).toBeNull();
            expect(adapter.getTranslation('name', 'constructor')).toBeNull();
        });

        it('should return null when getCatalog throws', () => {
            mockI18nNode.getCatalog.mockImplementation(() => {
                throw new Error('Error');
            });

            const result = adapter.getTranslation('hello', 'en');
            expect(result).toBeNull();
        });
    });

    describe('setTranslation', () => {
        beforeEach(() => {
            adapter.initialize(mockI18nNode, mockConfig);
        });

        it('should add translation to catalog', () => {
            adapter.setTranslation('greeting', 'fr', 'Bonjour');

            expect(catalogOf(mockI18nNode, 'fr')['greeting']).toBe('Bonjour');
        });

        it('should update existing catalog', () => {
            adapter.setTranslation('hello', 'en', 'Hi');

            expect(catalogOf(mockI18nNode, 'en')['hello']).toBe('Hi');
        });

        it('should write into the catalog i18n-node itself hands out', () => {
            // The write has to land in the object `getCatalog` returns, because that
            // object *is* i18n-node's registry entry — it is what `__()` reads. A
            // write into any other object is accepted in silence and never shows up.
            const before = catalogOf(mockI18nNode, 'en');

            adapter.setTranslation('hello', 'en', 'Hi');

            expect(catalogOf(mockI18nNode, 'en')).toBe(before);
            expect(before['hello']).toBe('Hi');
        });

        it('should register a locale i18n-node has not seen yet', () => {
            adapter.setTranslation('test', 'es', 'Prueba');

            expect(mockI18nNode.addLocale).toHaveBeenCalledWith('es');
            expect(catalogOf(mockI18nNode, 'es')['test']).toBe('Prueba');
        });

        it("should not write into a fallback locale's catalog", () => {
            // `getCatalog('fr')` hands back the *German* catalog here. Writing into
            // what it returns would store French under `de` and persist it to
            // `de.json` — which is what the second `getLocales()` check prevents.
            const withFallback = createMockI18nNodeWithFallback({ fr: 'de' });
            const fallbackAdapter = new I18nNodeAdapter();
            fallbackAdapter.initialize(withFallback, mockConfig);

            expect(() => fallbackAdapter.setTranslation('bonjour', 'fr', 'Bonjour')).toThrow(BackendError);
            expect(withFallback.locales['de']).toEqual({ hallo: 'Hallo' });
        });

        it('should refuse an empty locale', () => {
            // `getCatalog('')` returns i18n-node's whole registry rather than one
            // entry, so an empty locale would write a key into the locale map.
            expect(() => adapter.setTranslation('test', '', 'value')).toThrow(BackendError);
        });

        it('should report a refusal without stuttering the prefix', () => {
            const refusing = createMockI18nNode({ addLocale: vi.fn() });
            const refusingAdapter = new I18nNodeAdapter();
            refusingAdapter.initialize(refusing, mockConfig);

            expect(() => refusingAdapter.setTranslation('test', 'zz', 'Proba')).not.toThrow(
                /Failed to set translation in i18n-node: i18n-node/
            );
        });

        it('should report a locale i18n-node refuses to register', () => {
            // `addLocale` reads `<locale>.json`; with no such file and `updateFiles`
            // off it registers nothing, and there is no other way in. Dropping the
            // translation quietly is what this adapter used to do.
            const refusing = createMockI18nNode({ addLocale: vi.fn() });
            const refusingAdapter = new I18nNodeAdapter();
            refusingAdapter.initialize(refusing, mockConfig);

            expect(() => refusingAdapter.setTranslation('test', 'zz', 'Proba')).toThrow(BackendError);
        });

        it('should refuse a write before initialize', () => {
            // A write has nowhere to go without an instance, and saying so is the
            // contract here — `getTranslation` answers `null` in the same state,
            // because a read with nothing behind it is a miss, not a failure.
            const uninitialized = new I18nNodeAdapter();

            expect(() => uninitialized.setTranslation('test', 'en', 'value')).toThrow(
                'i18n-node adapter not initialized'
            );
        });

        it('should wrap a failure raised by i18n-node itself', () => {
            // Anything that is not already a `BackendError` came out of the
            // instance, and its message is the only account of what went wrong —
            // so it is carried into the wrap rather than replaced by a generic one.
            const failing = createMockI18nNode({
                getCatalog: vi.fn(() => {
                    throw new Error('catalog registry unavailable');
                }),
            });
            const failingAdapter = new I18nNodeAdapter();
            failingAdapter.initialize(failing, mockConfig);

            expect(() => failingAdapter.setTranslation('test', 'en', 'value')).toThrow(
                'Failed to set translation in i18n-node: catalog registry unavailable'
            );
        });

        it('should report a registered locale that hands out no catalog', () => {
            // `getLocales()` lists the locale, so neither registration check fires,
            // and `getCatalog` still answers with nothing. Without this last check
            // the key would be written into `undefined`.
            const empty = createMockI18nNode({
                getLocales: vi.fn(() => ['en']),
                getCatalog: vi.fn(() => undefined),
            });
            const emptyAdapter = new I18nNodeAdapter();
            emptyAdapter.initialize(empty, mockConfig);

            expect(() => emptyAdapter.setTranslation('test', 'en', 'value')).toThrow(
                'i18n-node returned no catalog for locale "en"'
            );
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
            mockI18nNode.getCatalog.mockImplementation((locale: string) => nestedCatalog[locale] ?? false);
            mockI18nNode.getLocales.mockImplementation(() => Object.keys(nestedCatalog));
            mockI18nNode.addLocale.mockImplementation((locale: string) => {
                nestedCatalog[locale] ??= {};
            });
            mockConfig.objectNotation = true;
            adapter.initialize(mockI18nNode, mockConfig);
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
            adapter.initialize(mockI18nNode, mockConfig);
        });

        it('should call callback when __ returns the key (missing)', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            // Call the overridden __ method with a missing key
            mockI18nNode.__('missing.key');

            expect(callback).toHaveBeenCalledWith('missing.key', 'en');
        });

        it('should not call callback when translation exists', () => {
            // Reset to get a fresh adapter with proper mock behavior
            const i18n = createMockI18nNode();
            i18n.__.mockImplementation((phrase: string) => {
                if (phrase === 'hello') return 'Hello';
                return phrase;
            });

            const adapterWithMock = new I18nNodeAdapter();
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
            mockI18nNode.__n('item', 'items', 1);

            expect(callback).toHaveBeenCalledWith('item', 'en');
        });

        it('should call callback when __n returns plural (missing)', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            mockI18nNode.__n('item', 'items', 5);

            expect(callback).toHaveBeenCalledWith('item', 'en');
        });
    });

    describe('edge cases', () => {
        it('should handle namespace parameter (ignored for i18n-node)', () => {
            adapter.initialize(mockI18nNode, mockConfig);

            // namespace is ignored for i18n-node but should not cause errors
            const result = adapter.getTranslation('hello', 'en', 'someNamespace');
            expect(result).toBe('Hello');
        });

        it('should preserve original __ behavior', () => {
            // Create a mock that tracks calls to original
            const i18n = createMockI18nNode();
            i18n.__ = vi.fn((phrase: string) => {
                return phrase === 'hello' ? 'Hello' : phrase;
            });

            const testAdapter = new I18nNodeAdapter();
            testAdapter.initialize(i18n, mockConfig);

            // Call the overridden method
            const result = i18n.__('hello');

            // Original behavior should be preserved
            expect(result).toBe('Hello');
        });

        it('should preserve original __n behavior', () => {
            const i18n = createMockI18nNode();
            i18n.__n = vi.fn((singular: string, plural: string, count: number) => {
                return count === 1 ? `One ${singular}` : `${count} ${plural}`;
            });

            const testAdapter = new I18nNodeAdapter();
            testAdapter.initialize(i18n, mockConfig);

            const result = i18n.__n('item', 'items', 3);

            expect(result).toBe('3 items');
        });
    });
});
