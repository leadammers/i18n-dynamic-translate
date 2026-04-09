import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpError } from '@/utils/http';
import { TranslationError } from '@/utils/errors';
import { TranslationProvider, DeepLModelType } from '@/types';
import { DeepLService } from '@/translators/deepl';
import { LibreTranslateService } from '@/translators/libreTranslate';

vi.mock('@/utils/http', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/http')>();
    return { ...actual, http: { post: vi.fn() } };
});

const mockPost = http.post as ReturnType<typeof vi.fn>;

afterEach(() => {
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// DeepLService
// ---------------------------------------------------------------------------
describe('DeepLService', () => {
    const baseConfig = {
        provider: TranslationProvider.DEEPL,
        apiKey: 'test-key-pro',
    };

    beforeEach(() => {
        mockPost.mockReset();
    });

    describe('constructor', () => {
        it('should throw TranslationError when apiKey is missing', () => {
            expect(
                () => new DeepLService({ provider: TranslationProvider.DEEPL }),
            ).toThrow(TranslationError);
        });

        it('should use free API URL for keys ending with :fx', () => {
            const service = new DeepLService({
                ...baseConfig,
                apiKey: 'key:fx',
            });
            // Trigger a translate to inspect the URL passed to http.post
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Hallo' }] },
                status: 200,
            });
            service.translate('Hello', 'en', 'de');
            expect(mockPost).toHaveBeenCalledWith(
                'https://api-free.deepl.com/v2/translate',
                expect.anything(),
                expect.anything(),
            );
        });

        it('should use pro API URL for other keys', () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Hallo' }] },
                status: 200,
            });
            service.translate('Hello', 'en', 'de');
            expect(mockPost).toHaveBeenCalledWith(
                'https://api.deepl.com/v2/translate',
                expect.anything(),
                expect.anything(),
            );
        });
    });

    describe('translate', () => {
        it('should call http.post with correct payload and return translated text', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Bonjour' }] },
                status: 200,
            });

            const result = await service.translate('Hello', 'en', 'fr');
            expect(result).toBe('Bonjour');
            expect(mockPost).toHaveBeenCalledWith(
                'https://api.deepl.com/v2/translate',
                expect.objectContaining({
                    source_lang: 'EN',
                    target_lang: 'FR',
                    text: ['Hello'],
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'DeepL-Auth-Key test-key-pro',
                    }),
                }),
            );
        });

        it('should throw TranslationError with sanitized message for 401 error', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockRejectedValue(new HttpError('Unauthorized', 401));

            await expect(service.translate('Hello', 'en', 'fr')).rejects.toThrow(TranslationError);
            await expect(service.translate('Hello', 'en', 'fr')).rejects.toThrow(
                /Authentication failed/,
            );
        });

        it('should throw TranslationError with sanitized message for 429 error', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockRejectedValue(new HttpError('Too Many Requests', 429));

            await expect(service.translate('Hello', 'en', 'fr')).rejects.toThrow(
                /Rate limit exceeded/,
            );
        });

        it('should throw TranslationError for network errors (ECONNREFUSED)', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockRejectedValue(new HttpError('Network error', undefined, 'ECONNREFUSED'));

            await expect(service.translate('Hello', 'en', 'fr')).rejects.toThrow(
                /Unable to connect/,
            );
        });
    });

    describe('translateBatch', () => {
        it('should return empty array for empty input', async () => {
            const service = new DeepLService(baseConfig);
            const result = await service.translateBatch([], 'en', 'fr');
            expect(result).toEqual([]);
            expect(mockPost).not.toHaveBeenCalled();
        });

        it('should send all texts in a single request', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockResolvedValue({
                data: {
                    translations: [{ text: 'Bonjour' }, { text: 'Au revoir' }],
                },
                status: 200,
            });

            const result = await service.translateBatch(['Hello', 'Goodbye'], 'en', 'fr');
            expect(result).toEqual(['Bonjour', 'Au revoir']);
            expect(mockPost).toHaveBeenCalledOnce();
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ text: ['Hello', 'Goodbye'] }),
                expect.anything(),
            );
        });
    });

    describe('language normalization', () => {
        it('should normalize EN to EN-US for target language', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Hi' }] },
                status: 200,
            });

            await service.translate('Hallo', 'de', 'EN');
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ target_lang: 'EN-US' }),
                expect.anything(),
            );
        });

        it('should normalize en-US to EN for source language', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Hallo' }] },
                status: 200,
            });

            await service.translate('Hello', 'en-US', 'de');
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ source_lang: 'EN' }),
                expect.anything(),
            );
        });
    });

    describe('buildRequestBody', () => {
        it('should include modelType in the payload', async () => {
            const service = new DeepLService({
                ...baseConfig,
                deeplOptions: { modelType: DeepLModelType.QUALITY },
            });
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Bonjour' }] },
                status: 200,
            });

            await service.translate('Hello', 'en', 'fr');
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ model_type: DeepLModelType.QUALITY }),
                expect.anything(),
            );
        });

        it('should default modelType to LATENCY when not specified', async () => {
            const service = new DeepLService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translations: [{ text: 'Bonjour' }] },
                status: 200,
            });

            await service.translate('Hello', 'en', 'fr');
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ model_type: DeepLModelType.LATENCY }),
                expect.anything(),
            );
        });
    });
});

// ---------------------------------------------------------------------------
// LibreTranslateService
// ---------------------------------------------------------------------------
describe('LibreTranslateService', () => {
    const baseConfig = {
        provider: TranslationProvider.LIBRE_TRANSLATE,
    };

    beforeEach(() => {
        mockPost.mockReset();
    });

    describe('constructor', () => {
        it('should use default URL when none provided', () => {
            const service = new LibreTranslateService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translatedText: 'Bonjour' },
                status: 200,
            });
            service.translate('Hello', 'en', 'fr');
            expect(mockPost).toHaveBeenCalledWith(
                'https://libretranslate.com/translate',
                expect.anything(),
                expect.anything(),
            );
        });

        it('should use custom URL when provided', () => {
            const service = new LibreTranslateService({
                ...baseConfig,
                apiUrl: 'https://my-instance.example.com/translate',
            });
            mockPost.mockResolvedValue({
                data: { translatedText: 'Bonjour' },
                status: 200,
            });
            service.translate('Hello', 'en', 'fr');
            expect(mockPost).toHaveBeenCalledWith(
                'https://my-instance.example.com/translate',
                expect.anything(),
                expect.anything(),
            );
        });
    });

    describe('translate', () => {
        it('should call http.post with correct payload', async () => {
            const service = new LibreTranslateService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translatedText: 'Bonjour' },
                status: 200,
            });

            await service.translate('Hello', 'en', 'fr');
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    q: 'Hello',
                    source: 'en',
                    target: 'fr',
                    format: 'text',
                }),
                expect.anything(),
            );
        });

        it('should return translatedText from response', async () => {
            const service = new LibreTranslateService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translatedText: 'Bonjour' },
                status: 200,
            });

            const result = await service.translate('Hello', 'en', 'fr');
            expect(result).toBe('Bonjour');
        });

        it('should include api_key in payload when configured', async () => {
            const service = new LibreTranslateService({
                ...baseConfig,
                apiKey: 'libre-key-123',
            });
            mockPost.mockResolvedValue({
                data: { translatedText: 'Bonjour' },
                status: 200,
            });

            await service.translate('Hello', 'en', 'fr');
            expect(mockPost).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ api_key: 'libre-key-123' }),
                expect.anything(),
            );
        });

        it('should not include api_key when not configured', async () => {
            const service = new LibreTranslateService(baseConfig);
            mockPost.mockResolvedValue({
                data: { translatedText: 'Bonjour' },
                status: 200,
            });

            await service.translate('Hello', 'en', 'fr');
            const payload = mockPost.mock.calls[0][1];
            expect(payload).not.toHaveProperty('api_key');
        });

        it('should throw TranslationError with sanitized message for errors', async () => {
            const service = new LibreTranslateService(baseConfig);
            mockPost.mockRejectedValue(new HttpError('Forbidden', 403));

            await expect(service.translate('Hello', 'en', 'fr')).rejects.toThrow(TranslationError);
            await expect(service.translate('Hello', 'en', 'fr')).rejects.toThrow(
                /Authentication failed/,
            );
        });
    });

    describe('translateBatch', () => {
        it('should return empty array for empty input', async () => {
            const service = new LibreTranslateService(baseConfig);
            const result = await service.translateBatch([], 'en', 'fr');
            expect(result).toEqual([]);
        });

        it('should translate texts individually via Promise.all', async () => {
            const service = new LibreTranslateService(baseConfig);
            mockPost
                .mockResolvedValueOnce({ data: { translatedText: 'Bonjour' }, status: 200 })
                .mockResolvedValueOnce({ data: { translatedText: 'Au revoir' }, status: 200 });

            const result = await service.translateBatch(['Hello', 'Goodbye'], 'en', 'fr');
            expect(result).toEqual(['Bonjour', 'Au revoir']);
            expect(mockPost).toHaveBeenCalledTimes(2);
        });
    });
});
