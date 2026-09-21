/**
 * Regression tests for bugs found in the 2026-09-21 full code review.
 * See docs/reviews/2026-09-21_full.md — each test is named after its finding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoTranslate } from '@/core/AutoTranslate';
import { Backend, StorageAdapter, TranslationProvider } from '@/types';
import { MemoryCache } from '@/utils/cache';
import { LibreTranslateService } from '@/translators/libreTranslate';
import { DeepLService } from '@/translators/deepl';
import { TranslationError } from '@/utils/errors';
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
                getCatalog: vi.fn(() => ({})),
                configure: vi.fn(),
                catalog: {} as Record<string, Record<string, string>>,
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

            cache.set('title', 'de', 'Titel', 'formal');

            expect(cache.get('title:formal', 'de')).toBeNull();
            expect(cache.has('title:formal', 'de')).toBe(false);
            cache.dispose();
        });

        it('keeps entries distinct across the locale boundary', () => {
            const cache = new MemoryCache();

            cache.set('name', 'de:products', 'Name');

            expect(cache.get('products:name', 'de')).toBeNull();
            expect(cache.has('products:name', 'de')).toBe(false);
            cache.dispose();
        });

        it('still serves a genuine repeat lookup from the cache', () => {
            const cache = new MemoryCache();

            cache.set('title', 'de', 'Titel', 'formal');

            expect(cache.get('title', 'de', 'formal')).toBe('Titel');
            expect(cache.get('title', 'de')).toBeNull();
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
});
