/**
 * Regression tests for bugs found in review. Each block is named after the
 * finding it came from; the 2026-09-21 ones are in docs/reviews/2026-09-21_full.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoTranslate } from '@/core/AutoTranslate';
import { Backend, LocaleData, StorageAdapter, TranslationProvider } from '@/types';
import { NodeI18nAdapter } from '@/adapters/nodeI18nAdapter';
import { setNestedValue } from '@/utils/objectPath';
import { MemoryCache } from '@/utils/cache';
import { LibreTranslateService } from '@/translators/libreTranslate';
import { DeepLService } from '@/translators/deepl';
import { BackendError, TranslationError } from '@/utils/errors';
import { http } from '@/utils/http';

const translateBatch = vi.fn((texts: string[]) => Promise.resolve(texts.map((text: string) => `X(${text})`)));
const translate = vi.fn((text: string) => Promise.resolve(`X(${text})`));

vi.mock('@/translators', () => ({
    createTranslationService: () => ({
        isAvailable: (): boolean => true,
        translate: (...args: unknown[]) => (translate as (...a: unknown[]) => Promise<string>)(...args),
        translateBatch: (...args: unknown[]) => (translateBatch as (...a: unknown[]) => Promise<string[]>)(...args),
    }),
}));

interface MockI18next {
    language: string;
    languages: string[];
    options: {
        ns: string[];
        missingKeyHandler: ((lngs: string[], ns: string, key: string, fallbackValue: string) => void) | null;
        saveMissing: boolean;
    };
    getFixedT: () => (key: string) => string;
    addResource: ReturnType<typeof vi.fn>;
}

function createMockI18next(): MockI18next {
    return {
        language: 'en',
        languages: ['en', 'de'],
        options: { ns: ['translation'], missingKeyHandler: null, saveMissing: false },
        getFixedT: () => (key: string) => key,
        addResource: vi.fn(),
    };
}

/**
 * Mirrors the one thing a real i18next does and the mock above does not: it
 * reports a failed lookup to the missing-key handler. i18next reports the miss
 * against the fallback language rather than the language that was looked up, so
 * reading the *default* language still arrives as a miss for the *target*
 * locale — which is how the library's own lookups re-entered the handler they
 * were called from. `lookups` records every key the library asked the backend
 * for, which is what makes that re-entry visible to an assertion.
 */
function createReportingMockI18next(fallbackLocale: string = 'de'): MockI18next & { lookups: string[] } {
    const instance: MockI18next & { lookups: string[] } = {
        language: 'de',
        languages: ['en', 'de'],
        options: { ns: ['translation'], missingKeyHandler: null, saveMissing: false },
        lookups: [],
        getFixedT: () => (key: string) => {
            instance.lookups.push(key);
            instance.options.missingKeyHandler?.([fallbackLocale], 'translation', key, key);
            return key;
        },
        addResource: vi.fn(),
    };

    return instance;
}

function createConfig(i18nInstance: unknown, overrides: Record<string, unknown> = {}) {
    return {
        backend: Backend.I18NEXT,
        i18nInstance,
        localesPath: '/tmp/regression-locales',
        defaultLanguage: 'en',
        translationProvider: { provider: TranslationProvider.DEEPL, apiKey: 'test-key:fx' },
        autoSave: false,
        enableCache: true,
        ...overrides,
    };
}

describe('review regressions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        translateBatch.mockImplementation((texts: string[]) =>
            Promise.resolve(texts.map((text: string) => `X(${text})`))
        );
        translate.mockImplementation((text: string) => Promise.resolve(`X(${text})`));
    });

    describe('C-1 cache identity', () => {
        it('does not serve one namespace translation to another namespace', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            await instance.translateKey('title', 'de', { namespace: 'products' });
            await instance.translateKey('title', 'de', { namespace: 'legal' });

            // Both namespaces must reach the provider — the cache must not conflate them
            expect(translate).toHaveBeenCalledTimes(2);
            await instance.dispose();
        });

        it('does not serve one parentKey translation to another parentKey', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            await instance.translateKey('name', 'de', { parentKey: 'user' });
            await instance.translateKey('name', 'de', { parentKey: 'company' });

            expect(translate).toHaveBeenCalledTimes(2);
            await instance.dispose();
        });

        it('still serves a genuine cache hit without calling the provider twice', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            const first = await instance.translateKey('title', 'de', { namespace: 'products' });
            const second = await instance.translateKey('title', 'de', { namespace: 'products' });

            expect(first).toBe(second);
            expect(translate).toHaveBeenCalledTimes(1);
            await instance.dispose();
        });
    });

    describe('C-2 dispose', () => {
        it('resolves instead of deadlocking while keys are still queued', async () => {
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next, { enableCache: false, onError: (): void => {} }));

            const fireMissingKey = i18next.options.missingKeyHandler;
            expect(fireMissingKey).not.toBeNull();
            for (let index = 0; index < 5; index++) {
                fireMissingKey?.(['de'], 'translation', `queued${index}`, '');
            }

            await expect(instance.dispose()).resolves.toBeUndefined();
        });
    });

    describe('C-3 batch scheduling', () => {
        it('flushes under a steady key stream instead of starving the batch', async () => {
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next, { enableCache: false }));

            const STREAM_LENGTH = 40;
            const fireMissingKey = i18next.options.missingKeyHandler;
            // One key every 20ms — faster than the 50ms debounce window, and the
            // stream runs for 800ms, longer than the 500ms max-wait cap.
            for (let index = 0; index < STREAM_LENGTH; index++) {
                fireMissingKey?.(['de'], 'translation', `streamed${index}`, '');
                await new Promise((resolve: (value: unknown) => void) => setTimeout(resolve, 20));
            }

            // The max-wait cap must have forced at least one flush by now
            expect(i18next.addResource.mock.calls.length).toBeGreaterThan(0);

            await instance.waitForPendingTranslations(5000);
            expect(i18next.addResource.mock.calls.length).toBe(STREAM_LENGTH);
            await instance.dispose();
        });
    });

    describe('C-4 short provider response', () => {
        it('rejects instead of persisting undefined when fewer translations come back', async () => {
            translateBatch.mockImplementationOnce(() => Promise.resolve(['only-one']));
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next));

            await expect(instance.translateObject({ one: 'a', two: 'b', three: 'c' }, 'de')).rejects.toThrow(
                /returned 1 translations for 3 requested/
            );

            const wroteUndefined = i18next.addResource.mock.calls.some((call: unknown[]) => call[3] === undefined);
            expect(wroteUndefined).toBe(false);
            await instance.dispose();
        });
    });

    describe('C-5 translateObject key collection', () => {
        it('translates keys whose values are not strings', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            const result = await instance.translateObject(
                { carrier: 'DHL', weight: 5, inStock: true, tags: ['a'], note: null },
                'de'
            );

            expect(Object.keys(result).sort()).toEqual(['carrier', 'inStock', 'note', 'tags', 'weight']);
            await instance.dispose();
        });

        it('still flattens nested objects to dot notation', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            const result = await instance.translateObject({ meta: { carrier: 'DHL', weight: 5 } }, 'de');

            expect(Object.keys(result).sort()).toEqual(['meta.carrier', 'meta.weight']);
            await instance.dispose();
        });
    });

    describe('C-6 LibreTranslate context', () => {
        it('does not send a context field LibreTranslate would not understand', async () => {
            const postSpy = vi.spyOn(http, 'post').mockResolvedValue({ data: { translatedText: 'Bank' }, status: 200 });
            const service = new LibreTranslateService({ provider: TranslationProvider.LIBRE_TRANSLATE });

            await service.translate('bank', 'en', 'de', 'financial');

            expect(postSpy.mock.calls[0][1]).toEqual({
                q: 'bank',
                source: 'en',
                target: 'de',
                format: 'text',
            });
            postSpy.mockRestore();
        });
    });

    describe('C-7 cache clear vs dispose', () => {
        it('keeps the expiry sweeper running after clear()', () => {
            const cache = new MemoryCache(1000, 10, 50);

            cache.clear();

            expect(cache.getStats().size).toBe(0);
            expect(Reflect.get(cache, 'cleanupTimer')).toBeDefined();
            cache.dispose();
        });

        it('stops the expiry sweeper on dispose()', () => {
            const cache = new MemoryCache(1000, 10, 50);

            cache.dispose();

            expect(Reflect.get(cache, 'cleanupTimer')).toBeUndefined();
        });
    });

    describe('C-9 production mode', () => {
        it('allows allow-listed namespaces', async () => {
            const i18next = createMockI18next();
            const instance = new AutoTranslate(
                createConfig(i18next, { mode: 'production', allowedNamespaces: ['products'] })
            );

            i18next.options.missingKeyHandler?.(['de'], 'products', 'title', '');
            await instance.waitForPendingTranslations(2000);

            expect(i18next.addResource).toHaveBeenCalled();
            await instance.dispose();
        });

        it('blocks namespaces outside the allow-list', async () => {
            const i18next = createMockI18next();
            const instance = new AutoTranslate(
                createConfig(i18next, { mode: 'production', allowedNamespaces: ['products'] })
            );

            i18next.options.missingKeyHandler?.(['de'], 'legal', 'title', '');
            await instance.waitForPendingTranslations(2000);

            expect(i18next.addResource).not.toHaveBeenCalled();
            await instance.dispose();
        });

        it('matches allow-list entries as key prefixes when the backend has no namespaces', async () => {
            const saved: string[] = [];
            const storageAdapter: StorageAdapter = {
                async save(_locale: string, key: string): Promise<void> {
                    saved.push(key);
                },
            };
            const nodeI18n = {
                __: vi.fn((phrase: string) => phrase),
                __n: vi.fn((singular: string) => singular),
                getLocale: vi.fn(() => 'de'),
                setLocale: vi.fn(),
                getLocales: vi.fn(() => ['en', 'de']),
                getCatalog: vi.fn((): LocaleData => ({})),
                addLocale: vi.fn(),
                configure: vi.fn(),
            };
            const instance = new AutoTranslate(
                createConfig(nodeI18n, {
                    backend: Backend.NODE_I18N,
                    mode: 'production',
                    allowedNamespaces: ['products.meta'],
                    autoSave: true,
                    storageAdapter,
                })
            );

            nodeI18n.__('products.meta.carrier');
            nodeI18n.__('legal.imprint');
            await instance.waitForPendingTranslations(2000);

            expect(saved).toEqual(['products.meta.carrier']);
            await instance.dispose();
        });
    });

    describe('P-1 malformed batch entry', () => {
        it('rejects instead of persisting undefined when an entry is not a string', async () => {
            // Shape of a DeepL response like { translations: [{}] }: the count is
            // right, so a length-only guard lets it straight through.
            translateBatch.mockImplementationOnce(() => Promise.resolve([undefined as unknown as string]));
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next));

            await expect(instance.translateObject({ one: 'a' }, 'de')).rejects.toThrow(
                /non-string translation at index 0/
            );

            const wroteUndefined = i18next.addResource.mock.calls.some((call: unknown[]) => call[3] === undefined);
            expect(wroteUndefined).toBe(false);
            await instance.dispose();
        });
    });

    describe('P-2 cache key injectivity', () => {
        it('does not conflate component values containing the separator', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            await instance.translateKey('title', 'de', { namespace: 'a|b', parentKey: 'c' });
            await instance.translateKey('title', 'de', { namespace: 'a', parentKey: 'b|c' });

            expect(translate).toHaveBeenCalledTimes(2);
            await instance.dispose();
        });

        it('still serves a genuine repeat lookup from the cache', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            await instance.translateKey('title', 'de', { namespace: 'a|b', parentKey: 'c' });
            await instance.translateKey('title', 'de', { namespace: 'a|b', parentKey: 'c' });

            expect(translate).toHaveBeenCalledTimes(1);
            await instance.dispose();
        });
    });

    describe('P-3 batch failure reporting', () => {
        it('reports a failed batch once per key, not once per key plus once combined', async () => {
            translateBatch.mockImplementationOnce(() => Promise.reject(new Error('provider down')));
            const onError = vi.fn();
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next, { onError }));

            i18next.options.missingKeyHandler?.(['de'], 'translation', 'alpha', '');
            i18next.options.missingKeyHandler?.(['de'], 'translation', 'beta', '');
            await instance.waitForPendingTranslations(2000);

            const reportedKeys = onError.mock.calls.map((call: unknown[]) => call[1] as string).sort();
            expect(reportedKeys).toEqual(['alpha', 'beta']);
            await instance.dispose();
        });
    });

    describe('C-10 getConfig', () => {
        it('returns a copy whose nested provider options cannot mutate the instance', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next(), { allowedNamespaces: ['products'] }));

            const config = instance.getConfig();
            (config.translationProvider as { apiKey?: string }).apiKey = 'leaked';
            (config.allowedNamespaces as string[]).push('legal');

            expect(instance.getConfig().translationProvider.apiKey).toBe('test-key:fx');
            expect(instance.getConfig().allowedNamespaces).toEqual(['products']);
            await instance.dispose();
        });
    });

    describe('P-4 MemoryCache key injectivity', () => {
        it('keeps an entry with a context distinct from one whose key absorbs it', () => {
            const cache = new MemoryCache();

            cache.set({ key: 'title', locale: 'de', context: 'formal' }, 'Titel');

            expect(cache.get({ key: 'title:formal', locale: 'de' })).toBeNull();
            expect(cache.has({ key: 'title:formal', locale: 'de' })).toBe(false);
            cache.dispose();
        });

        it('keeps entries distinct across the locale boundary', () => {
            const cache = new MemoryCache();

            cache.set({ key: 'name', locale: 'de:products' }, 'Name');

            expect(cache.get({ key: 'products:name', locale: 'de' })).toBeNull();
            expect(cache.has({ key: 'products:name', locale: 'de' })).toBe(false);
            cache.dispose();
        });

        it('keeps entries distinct across the namespace boundary', () => {
            const cache = new MemoryCache();

            cache.set({ key: 'title', locale: 'de', namespace: 'products' }, 'Produkttitel');

            expect(cache.get({ key: 'title', locale: 'de', namespace: 'legal' })).toBeNull();
            expect(cache.get({ key: 'products:title', locale: 'de' })).toBeNull();
            cache.dispose();
        });

        it('still serves a genuine repeat lookup from the cache', () => {
            const cache = new MemoryCache();

            cache.set({ key: 'title', locale: 'de', context: 'formal' }, 'Titel');

            expect(cache.get({ key: 'title', locale: 'de', context: 'formal' })).toBe('Titel');
            expect(cache.get({ key: 'title', locale: 'de' })).toBeNull();
            cache.dispose();
        });
    });

    describe('P-5 queue identity', () => {
        it('does not drop a missing key whose namespace and key re-split across the separator', async () => {
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next));

            i18next.options.missingKeyHandler?.(['de'], 'b', 'c:d', '');
            i18next.options.missingKeyHandler?.(['de'], 'b:c', 'd', '');
            await instance.waitForPendingTranslations(2000);

            const translatedKeys = i18next.addResource.mock.calls.map((call: unknown[]) => call[2] as string).sort();
            expect(translatedKeys).toEqual(['c:d', 'd']);
            await instance.dispose();
        });

        it('still collapses a genuine duplicate missing key into one translation', async () => {
            const i18next = createMockI18next();
            const instance = new AutoTranslate(createConfig(i18next));

            i18next.options.missingKeyHandler?.(['de'], 'products', 'title', '');
            i18next.options.missingKeyHandler?.(['de'], 'products', 'title', '');
            await instance.waitForPendingTranslations(2000);

            expect(i18next.addResource.mock.calls).toHaveLength(1);
            await instance.dispose();
        });
    });

    describe('P-6 malformed single translation', () => {
        it('rejects a DeepL response whose only entry carries no text', async () => {
            // Same shape P-1 guards on the batch path: { translations: [{}] }. The
            // single-text path checked the entry object, not its `text` field.
            vi.spyOn(http, 'post').mockResolvedValue({ data: { translations: [{}] }, status: 200 });
            const service = new DeepLService({ provider: TranslationProvider.DEEPL, apiKey: 'test-key:fx' });

            await expect(service.translate('Title', 'en', 'de')).rejects.toThrow(TranslationError);
        });
    });

    describe('P-7 one slot, one cache entry', () => {
        it('does not hold two cache entries for one physical translation slot', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            // Both address `product.meta.name` in the backend and the locale file.
            const viaParent = await instance.translateKey('name', 'de', { parentKey: 'product.meta' });
            const viaKey = await instance.translateKey('meta.name', 'de', { parentKey: 'product' });

            expect(translate).toHaveBeenCalledTimes(1);
            expect(viaKey).toBe(viaParent);
            await instance.dispose();
        });

        it('still separates two slots that merely share a suffix', async () => {
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            await instance.translateKey('name', 'de', { parentKey: 'product' });
            await instance.translateKey('name', 'de', { parentKey: 'legal' });

            expect(translate).toHaveBeenCalledTimes(2);
            await instance.dispose();
        });
    });

    describe('S-1 missing-key re-entry', () => {
        it('does not recurse when the backend reports its own lookup as another miss', async () => {
            const i18next = createReportingMockI18next();
            const instance = new AutoTranslate(createConfig(i18next));

            i18next.options.missingKeyHandler?.(['de'], 'translation', 'welcomeMessage', '');
            await instance.waitForPendingTranslations(2000);

            // One reported miss costs exactly one source-language lookup. Before
            // the fix that lookup was itself reported as a miss and the handler
            // re-entered itself until the stack ran out.
            expect(i18next.lookups).toEqual(['welcomeMessage']);
            expect(translateBatch).toHaveBeenCalledTimes(1);
            expect(translateBatch.mock.calls[0]?.[0]).toEqual(['Welcome Message']);
            await instance.dispose();
        });

        it('sends one provider request for an explicit translateKey', async () => {
            const i18next = createReportingMockI18next();
            const instance = new AutoTranslate(createConfig(i18next));

            const translated = await instance.translateKey('welcomeMessage', 'de');
            await instance.waitForPendingTranslations(2000);

            expect(translated).toBe('X(Welcome Message)');
            expect(translate).toHaveBeenCalledTimes(1);
            expect(translateBatch).not.toHaveBeenCalled();
            await instance.dispose();
        });
    });
    describe('S-2 prototype pollution through a dot path', () => {
        // A key reaches these functions as an arbitrary string — that is the point
        // of the library, whose keys come from API metadata rather than a build.
        // `__proto__` is an accessor on Object.prototype, so descending into it or
        // assigning to it reaches every object in the process instead of the catalog.
        const POLLUTED_PROPERTY = 'pollutedByRegressionTest';

        // Models the real `i18n` contract: no catalog property, `getCatalog` hands
        // out the live registry entry or `false`, and a locale is only registered
        // through `addLocale` — which registers own properties, exactly as reading
        // `<locale>.json` into the registry does.
        function createAdapter(
            overrides: Record<string, unknown>,
            locales: Record<string, LocaleData> = {}
        ): NodeI18nAdapter {
            const adapter = new NodeI18nAdapter();
            adapter.initialize(
                {
                    getLocales: (): string[] => Object.keys(locales),
                    // Character for character what i18n@0.15 does in `write()`: a
                    // guarded plain assignment. For `__proto__` the guard reads the
                    // inherited accessor, finds `Object.prototype`, and registers
                    // nothing — which is the behaviour under test.
                    addLocale: (locale: string): void => {
                        if (!locales[locale]) {
                            locales[locale] = {};
                        }
                    },
                    getCatalog: (locale: string): LocaleData | false =>
                        Object.prototype.hasOwnProperty.call(locales, locale) ? (locales[locale] as LocaleData) : false,
                    __: (phrase: string) => phrase,
                    __n: (singular: string) => singular,
                },
                { ...createConfig(createMockI18next()), backend: Backend.NODE_I18N, ...overrides }
            );
            return adapter;
        }

        afterEach(() => {
            // Runs even when an assertion below fails, so one red test cannot
            // corrupt every object in the rest of the suite.
            delete (Object.prototype as Record<string, unknown>)[POLLUTED_PROPERTY];
        });

        it('does not reach Object.prototype through a __proto__ segment', () => {
            const catalog: LocaleData = {};

            setNestedValue(catalog, `__proto__.${POLLUTED_PROPERTY}`, 'polluted');

            expect(({} as Record<string, unknown>)[POLLUTED_PROPERTY]).toBeUndefined();
        });

        it('stores a key literally named __proto__ instead of dropping it', () => {
            // The inverse assertion: a guard that refused the segment outright
            // would lose a translation the application legitimately asked for.
            const catalog: LocaleData = {};

            setNestedValue(catalog, `__proto__.${POLLUTED_PROPERTY}`, 'kept');

            const branch = Object.getOwnPropertyDescriptor(catalog, '__proto__')?.value as LocaleData;
            expect(branch?.[POLLUTED_PROPERTY]).toBe('kept');
            expect(Object.getPrototypeOf(catalog)).toBe(Object.prototype);
        });

        it('leaves an ordinary nested write unchanged', () => {
            const catalog: LocaleData = { products: { meta: { carrier: 'Carrier' } } };

            setNestedValue(catalog, 'products.meta.weight', 'Weight');

            expect(catalog).toEqual({ products: { meta: { carrier: 'Carrier', weight: 'Weight' } } });
        });

        it('says so when node-i18n will not register the locale', () => {
            // `locale` selects a catalog rather than indexing anything this library
            // owns, so there is no locale hardening here left to prove — the whole
            // assertion is that a name upstream refuses to hold is reported by name
            // instead of dropped in silence. An implementation falling back to
            // `getCatalog(locale) ?? {}` would not throw and would fail this.
            const locales: Record<string, LocaleData> = {};
            const adapter = createAdapter({ objectNotation: true }, locales);

            expect(() => adapter.setTranslation(POLLUTED_PROPERTY, '__proto__', 'polluted')).toThrow(BackendError);
            expect(() => adapter.setTranslation(POLLUTED_PROPERTY, '__proto__', 'polluted')).toThrow(/__proto__/);

            expect(({} as Record<string, unknown>)[POLLUTED_PROPERTY]).toBeUndefined();
            expect(Object.getPrototypeOf(locales)).toBe(Object.prototype);
        });

        it('stores a flat key named __proto__ instead of dropping it', () => {
            // Without `objectNotation` the catalog is written by a plain assignment,
            // which for this one name stores nothing at all — a paid translation lost.
            const locales: Record<string, LocaleData> = { en: {} };
            const adapter = createAdapter({ objectNotation: false }, locales);

            adapter.setTranslation('__proto__', 'en', 'kept');

            expect(Object.getOwnPropertyDescriptor(locales.en, '__proto__')?.value).toBe('kept');
            expect(({} as Record<string, unknown>).kept).toBeUndefined();
        });

        it('keeps a key named __proto__ in the object translateObject returns', async () => {
            // Keys arrive as JSON from an API, and `JSON.parse` makes `__proto__` an
            // ordinary own property — so the accumulator has to store it as one too.
            // The value in the input is ignored: `translateObject` translates key
            // paths, so the source text comes from the key itself.
            const instance = new AutoTranslate(createConfig(createMockI18next()));

            const result = await instance.translateObject(JSON.parse('{"__proto__": "ignored"}'), 'de');

            expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('X(Proto)');
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            await instance.dispose();
        });

        it('writes into a sealed catalog exactly as a plain assignment would', () => {
            // Defining a property is not a drop-in replacement for assigning one:
            // on a sealed or non-configurable target `defineProperty` throws where
            // the assignment this replaced simply succeeded.
            const sealed: LocaleData = Object.seal({ carrier: 'Carrier' });

            expect(() => setNestedValue(sealed, 'carrier', 'Frachtfuhrer')).not.toThrow();
            expect(sealed.carrier).toBe('Frachtfuhrer');
        });

        it('does not read a value off the prototype chain', () => {
            (Object.prototype as Record<string, unknown>)[POLLUTED_PROPERTY] = 'inherited';
            const adapter = createAdapter({ objectNotation: true }, { en: {} });

            expect(adapter.getTranslation(POLLUTED_PROPERTY, 'en')).toBeNull();
            expect(adapter.getTranslation(`__proto__.${POLLUTED_PROPERTY}`, 'en')).toBeNull();
        });
    });

    describe('N-1 backend refusal', () => {
        // A backend can decline a write it cannot make. Raising that out of
        // `updateTranslation` used to take the file write and the cache entry with
        // it, so a provider call that had already been paid for was lost entirely —
        // on `updateFiles: false`, the configuration the README recommends.
        function createRefusingNodeI18n() {
            return {
                __: vi.fn((phrase: string) => phrase),
                __n: vi.fn((singular: string) => singular),
                getLocale: vi.fn(() => 'en'),
                setLocale: vi.fn(),
                getLocales: vi.fn((): string[] => ['en']),
                getCatalog: vi.fn((locale: string): LocaleData | false => (locale === 'en' ? {} : false)),
                // `updateFiles` off and no `es.json`: nothing is registered.
                addLocale: vi.fn(),
                configure: vi.fn(),
            };
        }

        it('still persists a translation the backend would not take', async () => {
            const saved: Array<{ locale: string; key: string; value: string }> = [];
            const storageAdapter: StorageAdapter = {
                async save(locale: string, key: string, value: string): Promise<void> {
                    saved.push({ locale, key, value });
                },
            };
            const onError = vi.fn();
            const instance = new AutoTranslate(
                createConfig(createRefusingNodeI18n(), {
                    backend: Backend.NODE_I18N,
                    autoSave: true,
                    storageAdapter,
                    onError,
                })
            );

            await expect(instance.translateKey('greeting', 'es')).resolves.toBe('X(Greeting)');

            expect(saved).toEqual([{ locale: 'es', key: 'greeting', value: 'X(Greeting)' }]);
            expect(onError).toHaveBeenCalledOnce();
            expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/es/);
            await instance.dispose();
        });

        it('translates the rest of an object after one key is refused', async () => {
            // The write loop was unguarded, so the first refusal aborted it and
            // skipped the autoSave block for every key in the batch, not just one.
            const saved: string[] = [];
            const storageAdapter: StorageAdapter = {
                async save(_locale: string, key: string): Promise<void> {
                    saved.push(key);
                },
            };
            const nodeI18n = createRefusingNodeI18n();
            const instance = new AutoTranslate(
                createConfig(nodeI18n, {
                    backend: Backend.NODE_I18N,
                    autoSave: true,
                    storageAdapter,
                    onError: vi.fn(),
                })
            );

            const result = await instance.translateObject({ one: 'a', two: 'b' }, 'es');

            expect(result).toEqual({ one: 'X(One)', two: 'X(Two)' });
            expect(saved).toEqual(['one', 'two']);
            await instance.dispose();
        });
    });
});
