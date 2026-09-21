/**
 * AutoTranslate - Automatic Translation Library for i18n
 *
 * Supports i18next and Node.js i18n backends with automatic translation
 * using LibreTranslate or DeepL.
 *
 * @packageDocumentation
 */

export { AutoTranslate } from '@/core/AutoTranslate';

// Export types
export {
    AutoTranslateConfig,
    Backend,
    TranslationProvider,
    FileFormat,
    DeepLModelType,
    TranslationProviderConfig,
    BackendAdapter,
    TranslationService,
    MissingKeyCallback,
    TranslationCache,
    TranslationIdentity,
    CacheStats,
    LocaleData,
    StorageAdapter,
    StorageSaveEntry,
    AutoTranslateMode,
} from '@/types';

// Storage
export { FileStorageAdapter } from '@/storage/FileStorageAdapter';

// Export errors
export {
    AutoTranslateError,
    TranslationError,
    BackendError,
    FileSystemError,
    ConfigurationError,
} from '@/utils/errors';
