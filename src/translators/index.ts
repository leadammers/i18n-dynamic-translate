/**
 * Translation Service Factory
 * Creates appropriate translation service based on configuration
 */

import { TranslationService, TranslationProviderConfig, TranslationProvider } from '@/types';
import { LibreTranslateService } from '@/translators/libreTranslate';
import { DeepLService } from '@/translators/deepl';
import { ConfigurationError } from '@/utils/errors';

/**
 * Create a translation service instance
 */
export function createTranslationService(config: TranslationProviderConfig): TranslationService {
    switch (config.provider) {
        case TranslationProvider.LIBRE_TRANSLATE:
            return new LibreTranslateService(config);

        case TranslationProvider.DEEPL:
            return new DeepLService(config);

        default:
            throw new ConfigurationError(`Unknown translation provider: ${config.provider}`);
    }
}
