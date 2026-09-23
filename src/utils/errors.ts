/**
 * Custom error classes for AutoTranslate.
 *
 * This module provides a hierarchy of error classes for handling different
 * failure scenarios in the AutoTranslate internationalization library.
 *
 * @module errors
 */

/**
 * Base error class for all AutoTranslate errors.
 *
 * This class serves as the parent for all custom errors in the library,
 * allowing consumers to catch all AutoTranslate-related errors with a single
 * catch block if desired.
 *
 * @extends Error
 *
 * @example
 * ```typescript
 * try {
 *   await autoTranslate.translate('key', 'en', 'fr');
 * } catch (error) {
 *   if (error instanceof AutoTranslateError) {
 *     // Handle any AutoTranslate error
 *     console.error('AutoTranslate error:', error.message);
 *   }
 * }
 * ```
 */
export class AutoTranslateError extends Error {
    /**
     * Creates a new AutoTranslateError instance.
     *
     * @param message - A descriptive error message explaining what went wrong
     */
    constructor(message: string) {
        super(message);
        this.name = 'AutoTranslateError';
    }
}

/**
 * Error thrown when a translation operation fails.
 *
 * This error is thrown by translation service implementations (DeepL, LibreTranslate)
 * when API calls fail due to authentication errors, rate limiting, network issues,
 * or other translation-related problems.
 *
 * @extends AutoTranslateError
 *
 * @example
 * ```typescript
 * try {
 *   await translator.translate('Hello', 'en', 'fr');
 * } catch (error) {
 *   if (error instanceof TranslationError) {
 *     console.error(`Translation failed with ${error.provider}:`, error.message);
 *     if (error.originalError) {
 *       console.error('Caused by:', error.originalError);
 *     }
 *   }
 * }
 * ```
 */
export class TranslationError extends AutoTranslateError {
    /**
     * Creates a new TranslationError instance.
     *
     * @param message - A descriptive error message explaining the translation failure
     * @param provider - The name of the translation provider that failed (e.g., 'deepl', 'libretranslate')
     * @param originalError - The underlying error that caused this translation failure
     */
    constructor(
        message: string,
        public provider?: string,
        public originalError?: Error
    ) {
        super(message);
        this.name = 'TranslationError';
    }
}

/**
 * Error thrown when an i18n backend adapter encounters a problem.
 *
 * This error is thrown by backend adapters (i18next, i18n-node) when
 * initialization fails or translation operations cannot be completed
 * due to backend-specific issues.
 *
 * @extends AutoTranslateError
 *
 * @example
 * ```typescript
 * try {
 *   await adapter.init();
 * } catch (error) {
 *   if (error instanceof BackendError) {
 *     console.error(`Backend '${error.backend}' failed:`, error.message);
 *   }
 * }
 * ```
 */
export class BackendError extends AutoTranslateError {
    /**
     * Creates a new BackendError instance.
     *
     * @param message - A descriptive error message explaining the backend failure
     * @param backend - The name of the backend that failed (e.g., 'i18next', 'node-i18n')
     */
    constructor(
        message: string,
        public backend?: string
    ) {
        super(message);
        this.name = 'BackendError';
    }
}

/**
 * Error thrown when a file system operation fails.
 *
 * This error is thrown by file handler utilities when reading or writing
 * locale files (JSON, YAML) fails due to I/O errors, permission issues,
 * invalid file formats, or other file system problems.
 *
 * @extends AutoTranslateError
 *
 * @example
 * ```typescript
 * try {
 *   await fileHandler.readLocaleFile('/path/to/locales/en.json');
 * } catch (error) {
 *   if (error instanceof FileSystemError) {
 *     console.error(`Failed to access '${error.filePath}':`, error.message);
 *     if (error.originalError) {
 *       console.error('Caused by:', error.originalError);
 *     }
 *   }
 * }
 * ```
 */
export class FileSystemError extends AutoTranslateError {
    /**
     * Creates a new FileSystemError instance.
     *
     * @param message - A descriptive error message explaining the file system failure
     * @param filePath - The path to the file that caused the error
     * @param originalError - The underlying error that caused this file system failure
     */
    constructor(
        message: string,
        public filePath?: string,
        public originalError?: Error
    ) {
        super(message);
        this.name = 'FileSystemError';
    }
}

/**
 * Error thrown when configuration is invalid or missing.
 *
 * This error is thrown during AutoTranslate initialization when required
 * configuration properties are missing, when invalid parameters are
 * passed to methods, or when factory functions receive unknown types.
 *
 * @extends AutoTranslateError
 *
 * @example
 * ```typescript
 * try {
 *   const autoTranslate = new AutoTranslate({
 *     // Missing required properties
 *   });
 * } catch (error) {
 *   if (error instanceof ConfigurationError) {
 *     console.error('Invalid configuration:', error.message);
 *   }
 * }
 * ```
 */
export class ConfigurationError extends AutoTranslateError {
    /**
     * Creates a new ConfigurationError instance.
     *
     * @param message - A descriptive error message explaining the configuration problem
     */
    constructor(message: string) {
        super(message);
        this.name = 'ConfigurationError';
    }
}
