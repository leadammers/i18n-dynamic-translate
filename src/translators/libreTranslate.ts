/**
 * LibreTranslate Translation Service
 * Free and open-source translation API
 */

import { TranslationService, TranslationProviderConfig } from '@/types';
import { TranslationError } from '@/utils/errors';
import { http, isHttpError } from '@/utils/http';

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
        return !!this.apiUrl;
    }

    /**
     * Translate text using LibreTranslate
     */
    async translate(text: string, sourceLang: string, targetLang: string, context?: string): Promise<string> {
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
                timeout: 10000,
            });

            if (response.data && response.data.translatedText) {
                return response.data.translatedText;
            }

            throw new TranslationError('Invalid response from LibreTranslate API', 'libretranslate');
        } catch (error) {
            if (isHttpError(error)) {
                // Sanitize error message to avoid leaking API keys or URLs
                const statusCode = error.status;
                let message: string;
                if (statusCode === 401 || statusCode === 403) {
                    message = 'Authentication failed - check your API key';
                } else if (statusCode === 429) {
                    message = 'Rate limit exceeded';
                } else if (statusCode === 400) {
                    message = 'Invalid request - check language codes';
                } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                    message = 'Unable to connect to LibreTranslate API';
                } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                    message = 'Request timed out';
                } else {
                    message = `Request failed with status ${statusCode || 'unknown'}`;
                }
                throw new TranslationError(`LibreTranslate API error: ${message}`, 'libretranslate', error);
            }
            throw error;
        }
    }

    /**
     * Translate a batch of texts
     * @param texts
     * @param sourceLang
     * @param targetLang
     */
    async translateBatch(texts: string[], sourceLang: string, targetLang: string, context?: string): Promise<string[]> {
        // TODO: Implement batch translation if LibreTranslate supports it
        if (texts.length === 0) return [];
        return Promise.all(texts.map((text) => this.translate(text, sourceLang, targetLang, context)));
    }

    /**
     * Normalize language code for LibreTranslate (e.g., 'en-US' -> 'en')
     */
    private normalizeLangCode(lang: string): string {
        return lang.split('-')[0].toLowerCase();
    }
}
