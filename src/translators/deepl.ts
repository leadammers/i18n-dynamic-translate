/**
 * DeepL Translation Service
 * Professional translation API with high quality
 */

import axios, { AxiosError } from 'axios';
import { TranslationService, TranslationProviderConfig } from '@/types';
import { TranslationError } from '@/utils/errors';

export class DeepLService implements TranslationService {
    private apiKey: string;
    private apiUrl: string;
    private formality?: string;
    private context?: string;
    private splitSentences?: string;

    constructor(config: TranslationProviderConfig) {
        if (!config.apiKey) {
            throw new TranslationError('DeepL API key is required', 'deepl');
        }

        this.apiKey = config.apiKey;

        // Determine if using free or pro API
        const isFreeKey = config.apiKey.endsWith(':fx');
        this.apiUrl = isFreeKey ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';

        this.formality = config.deeplOptions?.formality;
        this.context = config.deeplOptions?.context;
        this.splitSentences = config.deeplOptions?.splitSentences;
    }

    /**
     * Check if the service is available
     */
    isAvailable(): boolean {
        return !!this.apiKey;
    }

    /**
     * Translate text using DeepL
     */
    async translate(text: string, sourceLang: string, targetLang: string, context?: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new TranslationError('DeepL API key not configured', 'deepl');
        }

        try {
            const params: Record<string, string> = {
                auth_key: this.apiKey,
                text,
                source_lang: this.normalizeSourceLang(sourceLang),
                target_lang: this.normalizeTargetLang(targetLang),
            };

            if (this.formality) {
                params.formality = this.formality;
            }

            const contextValue = context ?? this.context;
            if (contextValue) {
                params.context = contextValue;
            }

            if (this.splitSentences) {
                params.split_sentences = this.splitSentences;
            }

            const response = await axios.post(this.apiUrl, null, {
                params,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 10000,
            });

            if (response.data && response.data.translations && response.data.translations[0]) {
                return response.data.translations[0].text;
            }

            throw new TranslationError('Invalid response from DeepL API', 'deepl');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                // Sanitize error message to avoid leaking API keys
                const statusCode = axiosError.response?.status;
                let message: string;
                if (statusCode === 401 || statusCode === 403) {
                    message = 'Authentication failed - check your API key';
                } else if (statusCode === 429) {
                    message = 'Rate limit exceeded';
                } else if (statusCode === 456) {
                    message = 'Quota exceeded';
                } else if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
                    message = 'Unable to connect to DeepL API';
                } else if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
                    message = 'Request timed out';
                } else {
                    message = `Request failed with status ${statusCode || 'unknown'}`;
                }
                throw new TranslationError(`DeepL API error: ${message}`, 'deepl', error);
            }
            throw error;
        }
    }

    /**
     * Normalize source language code for DeepL
     */
    private normalizeSourceLang(lang: string): string {
        return lang.toUpperCase().split('-')[0];
    }

    /**
     * Normalize target language code for DeepL
     * DeepL requires specific codes for some languages (e.g., EN-US, EN-GB)
     */
    private normalizeTargetLang(lang: string): string {
        const normalized = lang.toUpperCase();

        // DeepL specific mappings
        const mappings: Record<string, string> = {
            EN: 'EN-US',
            PT: 'PT-PT',
        };

        const base = normalized.split('-')[0];
        return mappings[base] || normalized;
    }
}
