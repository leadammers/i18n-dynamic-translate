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
    private modelType?: string;

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
     * @param text Text to translate
     * @param sourceLang Source language code
     * @param targetLang Target language code
     * @param context Optional context to improve translation accuracy
     */
    async translate(text: string, sourceLang: string, targetLang: string, context?: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new TranslationError('DeepL API key not configured', 'deepl');
        }

        try {
            const commonData = this.buildRequestBody(context);
            const payload: Record<string, any> = {
                source_lang: this.normalizeSourceLang(sourceLang),
                target_lang: this.normalizeTargetLang(targetLang),
                text: [text],
                ...commonData,
            };

            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    Authorization: `DeepL-Auth-Key ${this.apiKey}`,
                    'Content-Type': 'application/json',
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
                this.handleApiError(axiosError);
            }
            throw error;
        }
    }

    /**
     * Translate a batch of texts using DeepL
     * @param texts Array of texts to translate
     * @param sourceLang Source language code
     * @param targetLang Target language code
     * @param context Optional context to improve translation accuracy
     */
    async translateBatch(texts: string[], sourceLang: string, targetLang: string, context?: string): Promise<string[]> {
        if (!this.isAvailable()) {
            throw new TranslationError('DeepL API key not configured', 'deepl');
        }

        if (texts.length === 0) return [];

        try {
            const commonData = this.buildRequestBody(context);
            const payload: Record<string, any> = {
                source_lang: this.normalizeSourceLang(sourceLang),
                target_lang: this.normalizeTargetLang(targetLang),
                text: texts,
                ...commonData,
            };

            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    Authorization: `DeepL-Auth-Key ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            });

            if (response.data && response.data.translations) {
                return response.data.translations.map((t: any) => t.text);
            }

            throw new TranslationError('Invalid response from DeepL API', 'deepl');
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                this.handleApiError(axiosError);
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

    /**
     * Build common payload from DeepL configuration
     * @param context Optional context to override the default context
     */
    private buildRequestBody(context?: string): Record<string, any> {
        const payload: Record<string, any> = {};

        if (this.modelType === 'latency') {
            payload.model_type = 'latency_optimized';
        } else if (this.modelType === 'quality') {
            payload.model_type = 'prefer_quality_optimized';
        }

        if (this.formality) {
            payload.formality = this.formality;
        }

        const contextValue = context ?? this.context;
        if (contextValue) {
            payload.context = contextValue;
        }

        if (this.splitSentences) {
            payload.split_sentences = this.splitSentences;
        }

        return payload;
    }

    /**
     * Handle API errors and sanitize messages
     * @param error Axios error object
     * @throws TranslationError with sanitized message
     */
    private handleApiError(error: AxiosError): never {
        // Sanitize error message to avoid leaking API keys
        const statusCode = error.response?.status;
        let message: string;
        if (statusCode === 401 || statusCode === 403) {
            message = 'Authentication failed - check your API key';
        } else if (statusCode === 429) {
            message = 'Rate limit exceeded';
        } else if (statusCode === 456) {
            message = 'Quota exceeded';
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            message = 'Unable to connect to DeepL API';
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
            message = 'Request timed out';
        } else {
            message = `Request failed with status ${statusCode || 'unknown'}`;
        }
        throw new TranslationError(`DeepL API error: ${message}`, 'deepl', error);
    }
}
