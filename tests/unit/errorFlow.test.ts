import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { AutoTranslate } from '@/core/AutoTranslate';
import { Backend, TranslationProvider } from '@/types';
import { TranslationError } from '@/utils/errors';
import { http, HttpError } from '@/utils/http';

// Not named after a source module, unlike the rest of `tests/unit/`: the subject
// is the path a provider failure takes out of the library — real translator, real
// `AutoTranslate`, only the socket replaced — and no single module owns it. The
// per-module suites cover the same failures one layer at a time: `http.test.ts`
// the retries, `translators.test.ts` the status-to-message mapping. What is only
// observable here is that the message survives the trip to `onError` intact, once
// per key, with the instance still usable afterwards.

/** Anything but a real credential. One test asserts this never reaches the consumer. */
const FAKE_API_KEY = 'not-a-real-deepl-key';
/**
 * The real host on purpose, and the one endpoint in this repository that is not a
 * placeholder. Nothing requests it: it is interpolated into an `HttpError` message
 * to stand in for a provider that echoed the request line back, and the test then
 * asserts that neither the host nor the key survives into `onError`. A placeholder
 * would assert that the library scrubs a string the library never produces.
 */
const DEEPL_URL = 'https://api.deepl.com/v2/translate';

type MissingKeyHandler = (lngs: string[], ns: string, key: string, fallbackValue: string) => void;
type ErrorHandler = (error: Error, key: string, locale: string) => void;

function createMockI18next() {
    return {
        language: 'en',
        languages: ['en', 'de'],
        options: {
            ns: ['translation'],
            missingKeyHandler: null as MissingKeyHandler | null,
            saveMissing: false,
        },
        // Every lookup misses, which is what puts a key on the queue in the first place.
        getFixedT: vi.fn(
            (_locale: string, _namespace: string) =>
                (key: string): string =>
                    key
        ),
        addResource: vi.fn(),
    };
}

function createConfig(i18nInstance: unknown, onError?: ErrorHandler) {
    return {
        backend: Backend.I18NEXT,
        i18nInstance,
        localesPath: '/tmp/error-flow-locales',
        defaultLanguage: 'en',
        translationProvider: {
            provider: TranslationProvider.DEEPL,
            apiKey: FAKE_API_KEY,
        },
        // No file writes and no cache: both would mask a failure this suite is watching for.
        autoSave: false,
        enableCache: false,
        ...(onError ? { onError } : {}),
    };
}

/** The shape DeepL returns for a successful batch. */
function deeplResponse(texts: string[]) {
    return { data: { translations: texts.map((text: string) => ({ text })) }, status: 200 };
}

describe('provider failures reaching the consumer', () => {
    let mockI18next: ReturnType<typeof createMockI18next>;
    let onError: Mock<ErrorHandler>;
    let instance: AutoTranslate | null;

    beforeEach(() => {
        mockI18next = createMockI18next();
        onError = vi.fn<ErrorHandler>();
        instance = null;
    });

    afterEach(async () => {
        await instance?.dispose();
        vi.restoreAllMocks();
    });

    /** Drive the backend's missing-key hook and wait for the batch to settle. */
    async function reportMissing(keys: string[], locale: string = 'de'): Promise<void> {
        const handler = mockI18next.options.missingKeyHandler;
        expect(handler).toBeTypeOf('function');

        for (const key of keys) {
            handler!([locale], 'translation', key, key);
        }

        await instance!.waitForPendingTranslations();
    }

    function failWith(error: HttpError): void {
        vi.spyOn(http, 'post').mockRejectedValue(error);
    }

    it('reports an authentication failure as a TranslationError', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        failWith(new HttpError('Request failed', 403));

        await reportMissing(['greeting.hello']);

        expect(onError).toHaveBeenCalledTimes(1);
        const [error, key, locale] = onError.mock.calls[0]!;
        expect(error).toBeInstanceOf(TranslationError);
        expect(error.message).toBe('DeepL API error: Authentication failed - check your API key');
        expect(key).toBe('greeting.hello');
        expect(locale).toBe('de');
    });

    it('keeps the API key and the request URL out of the reported error', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        // A provider that echoes the request is the case that leaks: the key rides in a
        // header and the text in the body, and neither may come back out through onError.
        failWith(new HttpError(`401 for ${DEEPL_URL} with DeepL-Auth-Key ${FAKE_API_KEY}`, 401));

        await reportMissing(['greeting.hello']);

        const reported = onError.mock.calls[0]![0];
        const serialized = `${reported.message}${reported.stack ?? ''}`;
        expect(serialized).not.toContain(FAKE_API_KEY);
        expect(serialized).not.toContain('deepl.com');
    });

    it('reports a rate limit without the provider status text', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        failWith(new HttpError('Too Many Requests', 429));

        await reportMissing(['greeting.hello']);

        expect(onError.mock.calls[0]![0].message).toBe('DeepL API error: Rate limit exceeded');
    });

    it('reports a timeout by its error code rather than a status', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        failWith(new HttpError('socket hang up', undefined, 'ETIMEDOUT'));

        await reportMissing(['greeting.hello']);

        expect(onError.mock.calls[0]![0].message).toBe('DeepL API error: Request timed out');
    });

    it('reports a response that is missing the translations field', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        vi.spyOn(http, 'post').mockResolvedValue({ data: { unexpected: true }, status: 200 });

        await reportMissing(['greeting.hello']);

        expect(onError.mock.calls[0]![0].message).toBe('Invalid response from DeepL API');
    });

    it('reports a batch that comes back short instead of persisting a gap', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        // Two keys go out, one translation comes back. Silently zipping these would
        // write the second key's slot from `undefined`.
        vi.spyOn(http, 'post').mockResolvedValue(deeplResponse(['Hallo']));

        await reportMissing(['greeting.hello', 'greeting.bye']);

        expect(onError).toHaveBeenCalledTimes(2);
        for (const [error] of onError.mock.calls) {
            expect(error.message).toBe('Translation provider returned 1 translations for 2 requested texts');
        }
        expect(mockI18next.addResource).not.toHaveBeenCalled();
    });

    it('reports a malformed entry inside an otherwise correct batch', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        // `{ translations: [{}] }` maps to `[undefined]` — the right length, the wrong type.
        vi.spyOn(http, 'post').mockResolvedValue({ data: { translations: [{}] }, status: 200 });

        await reportMissing(['greeting.hello']);

        expect(onError.mock.calls[0]![0].message).toBe(
            'Translation provider returned a non-string translation at index 0'
        );
        expect(mockI18next.addResource).not.toHaveBeenCalled();
    });

    it('reports a failed batch once per key, not once more for the batch itself', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        failWith(new HttpError('Service Unavailable', 503));

        await reportMissing(['greeting.hello', 'greeting.bye', 'greeting.welcome']);

        expect(onError).toHaveBeenCalledTimes(3);
        expect(onError.mock.calls.map(([, key]: [Error, string, string]) => key).sort()).toEqual([
            'greeting.bye',
            'greeting.hello',
            'greeting.welcome',
        ]);
    });

    it('stays usable after a failed batch', async () => {
        instance = new AutoTranslate(createConfig(mockI18next, onError));
        const post = vi.spyOn(http, 'post').mockRejectedValue(new HttpError('Bad Gateway', 502));

        await reportMissing(['greeting.hello']);
        expect(onError).toHaveBeenCalledTimes(1);

        post.mockResolvedValue(deeplResponse(['Tschüss']));
        await reportMissing(['greeting.bye']);

        expect(onError).toHaveBeenCalledTimes(1);
        expect(mockI18next.addResource).toHaveBeenCalledWith('de', 'translation', 'greeting.bye', 'Tschüss');
    });

    it('falls back to the console exactly once when no onError is configured', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation((): void => {});
        instance = new AutoTranslate(createConfig(mockI18next));
        failWith(new HttpError('Request failed', 403));

        await reportMissing(['greeting.hello']);

        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(consoleError.mock.calls[0]![0]).toContain('greeting.hello');
    });
});
