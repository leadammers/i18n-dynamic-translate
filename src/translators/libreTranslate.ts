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
        if (!this.isAvailable()) {
            throw new TranslationError('LibreTranslate API URL not configured', 'libretranslate');
        }

        try {
            const payload: Record<string, string> = {
                q: text,
                source: this.normalizeLangCode(sourceLang),
                target: this.normalizeLangCode(targetLang),
                format: 'text',
            };

            if (this.apiKey) {
                payload.api_key = this.apiKey;
            }

            const response = await http.post<{ translatedText: string }>(this.apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: REQUEST_TIMEOUT_MS,
            });

            if (response.data && response.data.translatedText) {
                return response.data.translatedText;
            }

            throw new TranslationError('Invalid response from LibreTranslate API', 'libretranslate');
        } catch (error) {
            if (isHttpError(error)) {
                const message = describeHttpError(error, 'LibreTranslate API', LIBRETRANSLATE_STATUS_MESSAGES);
                throw new TranslationError(`LibreTranslate API error: ${message}`, 'libretranslate', error);
            }
            throw error;
        }
    }

    /**
     * Translate a batch of texts.
     *
     * LibreTranslate exposes no batch endpoint, so this fans out to one request
     * per text. `maxConcurrency` on AutoTranslate bounds how many batches run at once.
     */
    async translateBatch(texts: string[], sourceLang: string, targetLang: string, context?: string): Promise<string[]> {
        if (texts.length === 0) return [];
        return Promise.all(texts.map((text: string) => this.translate(text, sourceLang, targetLang, context)));
    }

    /**
     * Normalize language code for LibreTranslate (e.g., 'en-US' -> 'en')
     */
    private normalizeLangCode(lang: string): string {
        return lang.split('-')[0].toLowerCase();
    }
}
