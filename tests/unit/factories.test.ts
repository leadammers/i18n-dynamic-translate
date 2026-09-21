import { describe, it, expect } from 'vitest';
import { createBackendAdapter } from '@/adapters';
import { createTranslationService } from '@/translators';
import { I18nextAdapter } from '@/adapters/i18nextAdapter';
import { NodeI18nAdapter } from '@/adapters/nodeI18nAdapter';
import { LibreTranslateService } from '@/translators/libreTranslate';
import { DeepLService } from '@/translators/deepl';
import { Backend, TranslationProvider } from '@/types';
import { ConfigurationError, TranslationError } from '@/utils/errors';

describe('Factory Functions', () => {
    describe('createBackendAdapter', () => {
        it('should create I18nextAdapter for I18NEXT backend', () => {
            const adapter = createBackendAdapter(Backend.I18NEXT);
            expect(adapter).toBeInstanceOf(I18nextAdapter);
        });

        it('should create NodeI18nAdapter for NODE_I18N backend', () => {
            const adapter = createBackendAdapter(Backend.NODE_I18N);
            expect(adapter).toBeInstanceOf(NodeI18nAdapter);
        });

        it('should throw ConfigurationError for unknown backend', () => {
            expect(() => {
                createBackendAdapter('unknown' as Backend);
            }).toThrow(ConfigurationError);

            expect(() => {
                createBackendAdapter('unknown' as Backend);
            }).toThrow('Unknown backend: unknown');
        });

        it('should throw ConfigurationError for null backend', () => {
            expect(() => {
                createBackendAdapter(null as any);
            }).toThrow(ConfigurationError);
        });

        it('should throw ConfigurationError for undefined backend', () => {
            expect(() => {
                createBackendAdapter(undefined as any);
            }).toThrow(ConfigurationError);
        });
    });

    describe('createTranslationService', () => {
        it('should create LibreTranslateService for LIBRE_TRANSLATE provider', () => {
            const service = createTranslationService({
                provider: TranslationProvider.LIBRE_TRANSLATE,
            });
            expect(service).toBeInstanceOf(LibreTranslateService);
        });

        it('should create DeepLService for DEEPL provider', () => {
            const service = createTranslationService({
                provider: TranslationProvider.DEEPL,
                apiKey: 'test-key',
            });
            expect(service).toBeInstanceOf(DeepLService);
        });

        it('should throw ConfigurationError for unknown provider', () => {
            expect(() => {
                createTranslationService({
                    provider: 'unknown' as TranslationProvider,
                });
            }).toThrow(ConfigurationError);

            expect(() => {
                createTranslationService({
                    provider: 'unknown' as TranslationProvider,
                });
            }).toThrow('Unknown translation provider: unknown');
        });

        it('should throw ConfigurationError for null provider', () => {
            expect(() => {
                createTranslationService({
                    provider: null as any,
                });
            }).toThrow(ConfigurationError);
        });

        it('should throw ConfigurationError for undefined provider', () => {
            expect(() => {
                createTranslationService({
                    provider: undefined as any,
                });
            }).toThrow(ConfigurationError);
        });

        it('should pass config options to LibreTranslateService', () => {
            const service = createTranslationService({
                provider: TranslationProvider.LIBRE_TRANSLATE,
                apiUrl: 'https://custom.api.com/translate',
                apiKey: 'my-key',
            });

            expect(service).toBeInstanceOf(LibreTranslateService);
            expect(service.isAvailable()).toBe(true);
        });

        it('should pass config options to DeepLService', () => {
            const service = createTranslationService({
                provider: TranslationProvider.DEEPL,
                apiKey: 'deepl-key:fx',
                deeplOptions: {
                    formality: 'more',
                    splitSentences: '1',
                },
            });

            expect(service).toBeInstanceOf(DeepLService);
            expect(service.isAvailable()).toBe(true);
        });

        it('should throw TranslationError when DeepL API key is missing', () => {
            expect(() => {
                createTranslationService({
                    provider: TranslationProvider.DEEPL,
                });
            }).toThrow(TranslationError);
        });
    });
});
