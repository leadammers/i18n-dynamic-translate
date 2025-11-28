/**
 * LibreTranslate Translation Service
 * Free and open-source translation API
 */

import axios, { AxiosError } from 'axios';
import { TranslationService, TranslationProviderConfig } from '@/types';
import { TranslationError } from '@/utils/errors';

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
    async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
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

            const response = await axios.post(this.apiUrl, payload, {
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
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                // Sanitize error message to avoid leaking API keys or URLs
                const statusCode = axiosError.response?.status;
                let message: string;
                if (statusCode === 401 || statusCode === 403) {
                    message = 'Authentication failed - check your API key';
                } else if (statusCode === 429) {
                    message = 'Rate limit exceeded';
                } else if (statusCode === 400) {
                    message = 'Invalid request - check language codes';
                } else if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
                    message = 'Unable to connect to LibreTranslate API';
                } else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
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
     * Normalize language code for LibreTranslate (e.g., 'en-US' -> 'en')
     */
    private normalizeLangCode(lang: string): string {
        return lang.split('-')[0].toLowerCase();
    }
}
