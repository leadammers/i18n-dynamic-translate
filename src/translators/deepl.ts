/**
 * DeepL Translation Service
 * Professional translation API with high quality
 */

import { DeepLModelType, TranslationProviderConfig, TranslationService } from '@/types';
import { TranslationError } from '@/utils/errors';
import { describeHttpError, http, HttpError, isHttpError } from '@/utils/http';

interface DeepLRequestPayload {
    source_lang: string;
    target_lang: string;
    text: string[];
    model_type?: string;
    formality?: string;
    context?: string;
    split_sentences?: string;
}

/** DeepL-specific status codes that need a clearer message than the generic fallback */
const DEEPL_STATUS_MESSAGES: Readonly<Record<number, string>> = {
    456: 'Quota exceeded',
    // DeepL's second rate-limit code, mapped to the same "too many requests,
    // please wait and resend" response as 429 in its OpenAPI spec. The generic
    // fallback would report it as an unknown status.
    529: 'Rate limit exceeded',
};

/** Request timeout for DeepL calls, in milliseconds */
const REQUEST_TIMEOUT_MS = 10000;

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
        this.modelType = config.deeplOptions?.modelType || DeepLModelType.LATENCY;
    }

    /**
     * Check if the service is available
     */
    isAvailable(): boolean {
        return Boolean(this.apiKey);
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
            const payload: DeepLRequestPayload = {
                source_lang: this.normalizeSourceLang(sourceLang),
                target_lang: this.normalizeTargetLang(targetLang),
                text: [text],
                ...this.buildRequestBody(context),
            };

            const response = await http.post<{ translations: { text: string }[] }>(this.apiUrl, payload, {
                headers: {
                    Authorization: `DeepL-Auth-Key ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: REQUEST_TIMEOUT_MS,
            });

            // The entry itself being present is not enough: DeepL can answer with
            // `{ translations: [{}] }`, and returning `.text` off that hands the
            // caller `undefined` typed as `string`, which then reaches the cache,
            // the backend and the locale file.
            const translation = response.data?.translations?.[0]?.text;
            if (typeof translation === 'string') {
                return translation;
            }

            throw new TranslationError('Invalid response from DeepL API', 'deepl');
        } catch (error) {
            if (isHttpError(error)) {
                this.handleApiError(error);
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
            const payload: DeepLRequestPayload = {
                source_lang: this.normalizeSourceLang(sourceLang),
                target_lang: this.normalizeTargetLang(targetLang),
                text: texts,
                ...this.buildRequestBody(context),
            };

            const response = await http.post<{ translations: { text: string }[] }>(this.apiUrl, payload, {
                headers: {
                    Authorization: `DeepL-Auth-Key ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: REQUEST_TIMEOUT_MS,
            });

            if (response.data && response.data.translations) {
                return response.data.translations.map((t: { text: string }) => t.text);
            }

            throw new TranslationError('Invalid response from DeepL API', 'deepl');
        } catch (error) {
            if (isHttpError(error)) {
                this.handleApiError(error);
            }
            throw error;
        }
    }

    /**
     * Normalize source language code for DeepL
     */
    private normalizeSourceLang(lang: string): string {
        return lang.toUpperCase().split('-')[0] ?? lang.toUpperCase();
    }

    /**
     * Normalize target language code for DeepL
     * DeepL requires specific codes for some languages (e.g., EN-US, EN-GB)
     */
    private normalizeTargetLang(lang: string): string {
        const normalized = lang.toUpperCase();

        // If the language already includes a regional variant (e.g., EN-GB), use it as-is
        if (normalized.includes('-')) {
            return normalized;
        }

        // Default mappings for bare language codes that DeepL requires a region for
        const defaultRegion: Record<string, string> = {
            EN: 'EN-US',
            PT: 'PT-PT',
        };

        return defaultRegion[normalized] || normalized;
    }

    /**
     * Build common payload from DeepL configuration
     * @param context Optional context to override the default context
     */
    private buildRequestBody(context?: string): Partial<DeepLRequestPayload> {
        const payload: Partial<DeepLRequestPayload> = {};

        if (this.modelType) {
            payload.model_type = this.modelType;
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
     * @param error HTTP error object
     * @throws TranslationError with sanitized message
     */
    private handleApiError(error: HttpError): never {
        const message = describeHttpError(error, 'DeepL API', DEEPL_STATUS_MESSAGES);
        throw new TranslationError(`DeepL API error: ${message}`, 'deepl', error);
    }
}
