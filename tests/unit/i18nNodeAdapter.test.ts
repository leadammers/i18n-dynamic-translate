import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nNodeAdapter } from '@/adapters/i18nNodeAdapter';
import { BackendError } from '@/utils/errors';
import { getNestedValue, getOwnProperty } from '@/utils/objectPath';
import { Backend, TranslationProvider, LocaleData } from '@/types';

// Spied, not replaced: `spy: true` keeps every real implementation, so no test below changes
// behaviour by being here. These two functions are the only ways this adapter reads a catalog,
// which is what lets a test assert that a guard returned *before* the read — an assertion on the
// return value alone cannot, because a guard that answers `null` and a read that finds nothing
// answer the same thing.
vi.mock('@/utils/objectPath', { spy: true });

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

        it('should not stack the missing-key override on a second initialize call', () => {
            adapter.initialize(mockI18nNode, mockConfig);
            const overrideAfterFirstCall = mockI18nNode.__;

            // Guarded by `this.initialized` — a second call must leave __ exactly as the
            // first call installed it, not wrap it again.
            adapter.initialize(mockI18nNode, mockConfig);

            expect(mockI18nNode.__).toBe(overrideAfterFirstCall);
        });
    });

    describe('setupMissingKeyHandler guard', () => {
        it('does nothing when called without an i18n-node instance', () => {
            // Unreachable through the public API: initialize() already validates the instance
            // before calling this, so the guard never fires on a path a caller can reach. Called
            // directly, through a cast that drops the private modifier, to prove the guard itself.
            const uncalledAdapter = new I18nNodeAdapter() as unknown as { setupMissingKeyHandler: () => void };

            expect(() => uncalledAdapter.setupMissingKeyHandler()).not.toThrow();
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

        it('should return null for a locale getLocales lists but getCatalog reports false for', () => {
            // A state the library never creates on its own — getLocales() and getCatalog()
            // normally agree — but the guard on the catalog return has to hold regardless of
            // what put the instance into it.
            //
            // `toBeNull()` on its own does not pin that guard, and asserting it alone would be a
            // test that cannot fail: `getOwnProperty(false, key)` auto-boxes the primitive rather
            // than throwing, finds no own property, and the `typeof translation === 'string'`
            // ternary below it answers `null` for the same input. What the guard actually promises
            // is that a falsy catalog is never *read*, so that is what is asserted.
            mockI18nNode.getLocales.mockReturnValue(['en', 'zz']);
            vi.mocked(getOwnProperty).mockClear();
            vi.mocked(getNestedValue).mockClear();

            const result = adapter.getTranslation('anything', 'zz');

            expect(result).toBeNull();
            expect(vi.mocked(getOwnProperty)).not.toHaveBeenCalled();
            expect(vi.mocked(getNestedValue)).not.toHaveBeenCalled();
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

        it('should wrap an Error raised by i18n-node itself', () => {
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

        it('should wrap a non-Error raised by i18n-node itself', () => {
            // Nothing guarantees a thrown value is an `Error`, and a thrown string
            // still has to reach the message rather than land there as
            // `[object Object]`. The distinct text is what tells the two arms apart
            // when one of them breaks.
            const throwingString = createMockI18nNode({
                getCatalog: vi.fn(() => {
                    throw 'catalog registry closed';
                }),
            });
            const stringAdapter = new I18nNodeAdapter();
            stringAdapter.initialize(throwingString, mockConfig);

            expect(() => stringAdapter.setTranslation('test', 'en', 'value')).toThrow(
                'Failed to set translation in i18n-node: catalog registry closed'
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

    describe('reportError', () => {
        beforeEach(() => {
            adapter.initialize(mockI18nNode, mockConfig);
        });

        it('should fall back to console.error when no onError hook is configured', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((): void => {});
            try {
                const rejection = new Error('callback failed');
                adapter.onMissingKey(() => Promise.reject(rejection));

                // Triggers the __ override's catch, which is one of the two call sites
                // reportError has in this adapter.
                mockI18nNode.__('missing.key');

                await vi.waitFor(() => {
                    expect(consoleErrorSpy).toHaveBeenCalled();
                });
                expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('missing.key'), rejection);
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });

        it('should route to the configured onError hook instead of the console', async () => {
            const onError = vi.fn();
            const configWithOnError = { ...mockConfig, onError };
            const routedAdapter = new I18nNodeAdapter();
            const routedI18nNode = createMockI18nNode();
            routedAdapter.initialize(routedI18nNode, configWithOnError);

            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((): void => {});
            try {
                const rejection = new Error('callback failed');
                routedAdapter.onMissingKey(() => Promise.reject(rejection));

                // Triggers the __n override's catch, the other reportError call site.
                routedI18nNode.__n('missing.key', 'missing.keys', 1);

                await vi.waitFor(() => {
                    expect(onError).toHaveBeenCalledWith(rejection, 'missing.key', 'en');
                });
                expect(consoleErrorSpy).not.toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });
    });

    describe('before initialize', () => {
        it('disagrees across the three lifecycle methods: setTranslation throws, getTranslation misses, destroy no-ops', () => {
            const uninitializedAdapter = new I18nNodeAdapter();

            // This asserts the contract, not the lines that implement it. `getTranslation`'s
            // `if (!this.i18n) return null` is not pinned by any assertion the public API can
            // make: with the guard gone, `this.i18n.getLocales()` throws inside the method's own
            // `try` and the `catch` answers `null` too, so every observable is identical. The
            // guard stays because a miss should not be routed through an exception, but that is
            // a readability contract, not a testable one. `setTranslation`'s guard and
            // `destroy`'s are pinned — by the message assertion in `setTranslation` above and by
            // the `destroy` tests below.
            expect(() => uninitializedAdapter.setTranslation('key', 'en', 'value')).toThrow(BackendError);
            expect(uninitializedAdapter.getTranslation('key', 'en')).toBeNull();
            expect(() => uninitializedAdapter.destroy()).not.toThrow();
        });
    });

    describe('destroy', () => {
        it('should restore the original __ and __n methods', () => {
            // `original__`/`original__n` are bound copies of the pre-override methods
            // (`i18n.__.bind(i18n)`), so restoring them leaves a different function
            // object than the one initialize() found — the observable promise is that
            // it is no longer *this adapter's* wrapper, and behaves like the original.
            adapter.initialize(mockI18nNode, mockConfig);
            const overridden__ = mockI18nNode.__;
            const overridden__n = mockI18nNode.__n;

            adapter.destroy();

            expect(mockI18nNode.__).not.toBe(overridden__);
            expect(mockI18nNode.__n).not.toBe(overridden__n);

            const callback = vi.fn();
            adapter.onMissingKey(callback);
            mockI18nNode.__('hello');
            expect(callback).not.toHaveBeenCalled();
        });

        it('should leave __ untouched when there is nothing to restore', () => {
            adapter.initialize(mockI18nNode, mockConfig);
            const overridden__ = mockI18nNode.__;

            // `original__` is unset only when setupMissingKeyHandler's own guard exits
            // early, which the public contract never allows once initialize() has
            // validated the instance — forced here to prove destroy()'s own guard,
            // not to claim this state is reachable through initialize()/destroy() alone.
            Reflect.deleteProperty(adapter as unknown as Record<string, unknown>, 'original__');

            adapter.destroy();

            expect(mockI18nNode.__).toBe(overridden__);
        });

        it('should leave __n untouched when there is nothing to restore', () => {
            adapter.initialize(mockI18nNode, mockConfig);
            const overridden__n = mockI18nNode.__n;

            Reflect.deleteProperty(adapter as unknown as Record<string, unknown>, 'original__n');

            adapter.destroy();

            expect(mockI18nNode.__n).toBe(overridden__n);
        });

        it('should treat a second destroy() as a no-op', () => {
            // `docs/conventions/concurrency.md` states it; nothing asserted it until now.
            adapter.initialize(mockI18nNode, mockConfig);
            adapter.destroy();
            const restored__ = mockI18nNode.__;
            const restored__n = mockI18nNode.__n;

            expect(() => adapter.destroy()).not.toThrow();

            expect(mockI18nNode.__).toBe(restored__);
            expect(mockI18nNode.__n).toBe(restored__n);
        });

        it('should decline to restore once the adapter is no longer initialized', () => {
            adapter.initialize(mockI18nNode, mockConfig);
            const overridden__ = mockI18nNode.__;
            const overridden__n = mockI18nNode.__n;

            // The `!this.initialized` half of destroy()'s own guard. Through the public API the
            // flag and the instance reference are cleared together, so "flag down, host still
            // held" is not reachable — forced here through a cast that drops the private
            // modifier, the same way the two "nothing to restore" cases above are, and for the
            // same reason: without it the disjunct is executed but nothing can fail on it.
            (adapter as unknown as { initialized: boolean }).initialized = false;

            adapter.destroy();

            expect(mockI18nNode.__).toBe(overridden__);
            expect(mockI18nNode.__n).toBe(overridden__n);
        });

        it('should re-attach when initialize() is called again on the same adapter', () => {
            // Same adapter instance re-used, which is a different claim from the round trip the
            // i18next suite makes with a second adapter against one host: this one only passes if
            // destroy() cleared `initialized`, because otherwise the second initialize() returns
            // on its own double-init guard and the host is left unhooked.
            adapter.initialize(mockI18nNode, mockConfig);
            adapter.destroy();

            adapter.initialize(mockI18nNode, mockConfig);

            const callback = vi.fn();
            adapter.onMissingKey(callback);
            mockI18nNode.__('missing.key');
            expect(callback).toHaveBeenCalledWith('missing.key', 'en');

            // And the re-attached override comes off again on the next destroy().
            adapter.destroy();

            const callbackAfterSecondDestroy = vi.fn();
            adapter.onMissingKey(callbackAfterSecondDestroy);
            mockI18nNode.__('missing.key');
            expect(callbackAfterSecondDestroy).not.toHaveBeenCalled();
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
