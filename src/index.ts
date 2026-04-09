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
    CacheEntry,
    LocaleData,
    StorageAdapter,
    StorageSaveEntry,
    FileOperationResult,
} from '@/types';

// Storage
export { FileStorageAdapter } from '@/storage/FileStorageAdapter';

// Export utilities
export {
    convertKeyToText,
    convertKeyToSentence,
    isNestedKey,
    getLastSegment,
    getParentPath,
} from '@/utils/keyConverter';

export {
    readLocaleFile,
    writeLocaleFile,
    appendTranslationToFile,
    getLocaleFilePath,
    setNestedValue,
    getNestedValue,
} from '@/utils/fileHandler';

// Export errors
export {
    AutoTranslateError,
    TranslationError,
    BackendError,
    FileSystemError,
    ConfigurationError,
} from '@/utils/errors';
