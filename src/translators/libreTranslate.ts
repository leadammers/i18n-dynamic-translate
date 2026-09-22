/**
 * LibreTranslate Translation Service
 * Free and open-source translation API
 */

import { TranslationService, TranslationProviderConfig } from '@/types';
import { TranslationError } from '@/utils/errors';
import { describeHttpError, http, isHttpError } from '@/utils/http';

/** LibreTranslate-specific status codes that need a clearer message than the generic fallback */
const LIBRETRANSLATE_STATUS_MESSAGES: Readonly<Record<number, string>> = {
    400: 'Invalid request - check language codes',
};

/** Request timeout for LibreTranslate calls, in milliseconds */
const REQUEST_TIMEOUT_MS = 10000;

export class LibreTranslateService implements TranslationService {
    private apiUrl: string;
    private apiKey?: string;

    constructor(config: TranslationProviderConfig) {
        this.apiUrl = config.apiUrl || 'https://libretranslate.com/translate';
        this.apiKey = config.apiKey;
    }

    /**
     * Check if the service is available
     */
    isAvailable(): boolean {
        return Boolean(this.apiUrl);
    }

    /**
     * Translate text using LibreTranslate
     *
     * Note: LibreTranslate has no context parameter in its API. The `context`
     * argument is accepted to satisfy the TranslationService interface and is
     * ignored — use DeepL if context-aware translation matters.
     */
    async translate(text: string, sourceLang: string, targetLang: string, _context?: string): Promise<string> {
        const translated = await this.request(text, sourceLang, targetLang);

        // `typeof`, not truthiness: an empty translation is a value the server is
        // entitled to return, and rejecting it would turn a legitimate answer into
        // an error. A missing field or a null arrives as `undefined` and is caught.
        if (typeof translated !== 'string') {
            throw new TranslationError('Invalid response from LibreTranslate API', 'libretranslate');
        }

        return translated;
    }

    /**
     * Translate a batch of texts in a single request.
     *
     * `/translate` accepts `q` as an array and answers with `translatedText` as an
     * array in the same order, so a batch costs one request rather than one per
     * text — which is what keeps a rate-limited instance from rejecting the tail
     * of a batch. An empty `q` array is rejected by the API, hence the early return.
     *
     * An endpoint that does not accept an array answers with a single string, which
     * is reported as such rather than as a generic bad response — that is the shape
     * a proxy in front of `/translate`, or a server predating array support, returns.
     */
    async translateBatch(
        texts: string[],
        sourceLang: string,
        targetLang: string,
        _context?: string
    ): Promise<string[]> {
        if (texts.length === 0) return [];

        const translated = await this.request(texts, sourceLang, targetLang);

        if (!Array.isArray(translated)) {
            const detail =
                typeof translated === 'string'
                    ? 'the endpoint answered a batch with a single translation, so it does not accept a batched request'
                    : 'the response carried no translation array';
            throw new TranslationError(`Invalid response from LibreTranslate API: ${detail}`, 'libretranslate');
        }

        return translated;
    }

    /**
     * Post one `/translate` call. `texts` carries either a single text or a batch,
     * and the response mirrors that shape.
     *
     * The result is `unknown` on purpose. Nothing between here and the socket checks
     * what came back, so a generic parameter here would be an assertion dressed as a
     * type: the callers narrow, and only their narrowing is worth anything.
     */
    private async request(texts: string | string[], sourceLang: string, targetLang: string): Promise<unknown> {
        if (!this.isAvailable()) {
            throw new TranslationError('LibreTranslate API URL not configured', 'libretranslate');
        }

        const payload: Record<string, string | string[]> = {
            q: texts,
            source: this.normalizeLangCode(sourceLang),
            target: this.normalizeLangCode(targetLang),
            format: 'text',
        };

        if (this.apiKey) {
            payload.api_key = this.apiKey;
        }

        try {
            const response = await http.post<{ translatedText: unknown }>(this.apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: REQUEST_TIMEOUT_MS,
            });

            return response.data?.translatedText;
        } catch (error) {
            if (isHttpError(error)) {
                const message = describeHttpError(error, 'LibreTranslate API', LIBRETRANSLATE_STATUS_MESSAGES);
                throw new TranslationError(`LibreTranslate API error: ${message}`, 'libretranslate', error);
            }
            throw error;
        }
    }

    /**
     * Normalize language code for LibreTranslate (e.g., 'en-US' -> 'en')
     */
    private normalizeLangCode(lang: string): string {
        return (lang.split('-')[0] ?? lang).toLowerCase();
    }
}
