import { describe, it, expect } from 'vitest';
import {
    AutoTranslateError,
    TranslationError,
    BackendError,
    FileSystemError,
    ConfigurationError,
} from '@/utils/errors';

describe('Error Classes', () => {
    describe('AutoTranslateError', () => {
        it('should create error with message', () => {
            const error = new AutoTranslateError('Test error');
            expect(error.message).toBe('Test error');
            expect(error.name).toBe('AutoTranslateError');
        });

        it('should be instance of Error', () => {
            const error = new AutoTranslateError('Test error');
            expect(error).toBeInstanceOf(Error);
        });

        it('should be instance of AutoTranslateError', () => {
            const error = new AutoTranslateError('Test error');
            expect(error).toBeInstanceOf(AutoTranslateError);
        });

        it('should have stack trace', () => {
            const error = new AutoTranslateError('Test error');
            expect(error.stack).toBeDefined();
        });
    });

    describe('TranslationError', () => {
        it('should create error with message only', () => {
            const error = new TranslationError('Translation failed');
            expect(error.message).toBe('Translation failed');
            expect(error.name).toBe('TranslationError');
            expect(error.provider).toBeUndefined();
            expect(error.originalError).toBeUndefined();
        });

        it('should create error with provider', () => {
            const error = new TranslationError('Translation failed', 'deepl');
            expect(error.message).toBe('Translation failed');
            expect(error.provider).toBe('deepl');
        });

        it('should create error with original error', () => {
            const original = new Error('Network error');
            const error = new TranslationError('Translation failed', 'libretranslate', original);
            expect(error.originalError).toBe(original);
            expect(error.provider).toBe('libretranslate');
        });

        it('should be instance of AutoTranslateError', () => {
            const error = new TranslationError('Test');
            expect(error).toBeInstanceOf(AutoTranslateError);
        });

        it('should be instance of Error', () => {
            const error = new TranslationError('Test');
            expect(error).toBeInstanceOf(Error);
        });
    });

    describe('BackendError', () => {
        it('should create error with message only', () => {
            const error = new BackendError('Backend failed');
            expect(error.message).toBe('Backend failed');
            expect(error.name).toBe('BackendError');
            expect(error.backend).toBeUndefined();
        });

        it('should create error with backend', () => {
            const error = new BackendError('Backend failed', 'i18next');
            expect(error.backend).toBe('i18next');
        });

        it('should be instance of AutoTranslateError', () => {
            const error = new BackendError('Test');
            expect(error).toBeInstanceOf(AutoTranslateError);
        });
    });

    describe('FileSystemError', () => {
        it('should create error with message only', () => {
            const error = new FileSystemError('File read failed');
            expect(error.message).toBe('File read failed');
            expect(error.name).toBe('FileSystemError');
            expect(error.filePath).toBeUndefined();
            expect(error.originalError).toBeUndefined();
        });

        it('should create error with file path', () => {
            const error = new FileSystemError('File read failed', '/path/to/file.json');
            expect(error.filePath).toBe('/path/to/file.json');
        });

        it('should create error with original error', () => {
            const original = new Error('ENOENT');
            const error = new FileSystemError('File not found', '/path/to/file.json', original);
            expect(error.originalError).toBe(original);
            expect(error.filePath).toBe('/path/to/file.json');
        });

        it('should be instance of AutoTranslateError', () => {
            const error = new FileSystemError('Test');
            expect(error).toBeInstanceOf(AutoTranslateError);
        });
    });

    describe('ConfigurationError', () => {
        it('should create error with message', () => {
            const error = new ConfigurationError('Invalid config');
            expect(error.message).toBe('Invalid config');
            expect(error.name).toBe('ConfigurationError');
        });

        it('should be instance of AutoTranslateError', () => {
            const error = new ConfigurationError('Test');
            expect(error).toBeInstanceOf(AutoTranslateError);
        });
    });

    describe('Error hierarchy', () => {
        it('should allow catching all AutoTranslate errors with base class', () => {
            const errors = [
                new TranslationError('Translation error'),
                new BackendError('Backend error'),
                new FileSystemError('Filesystem error'),
                new ConfigurationError('Config error'),
            ];

            for (const error of errors) {
                expect(error).toBeInstanceOf(AutoTranslateError);
                expect(error).toBeInstanceOf(Error);
            }
        });

        it('should allow distinguishing error types', () => {
            const translationError = new TranslationError('Test');
            const backendError = new BackendError('Test');
            const fileSystemError = new FileSystemError('Test');
            const configError = new ConfigurationError('Test');

            expect(translationError).toBeInstanceOf(TranslationError);
            expect(translationError).not.toBeInstanceOf(BackendError);

            expect(backendError).toBeInstanceOf(BackendError);
            expect(backendError).not.toBeInstanceOf(TranslationError);

            expect(fileSystemError).toBeInstanceOf(FileSystemError);
            expect(fileSystemError).not.toBeInstanceOf(BackendError);

            expect(configError).toBeInstanceOf(ConfigurationError);
            expect(configError).not.toBeInstanceOf(FileSystemError);
        });
    });

    describe('Error name property', () => {
        it('should have correct name for each error type', () => {
            expect(new AutoTranslateError('Test').name).toBe('AutoTranslateError');
            expect(new TranslationError('Test').name).toBe('TranslationError');
            expect(new BackendError('Test').name).toBe('BackendError');
            expect(new FileSystemError('Test').name).toBe('FileSystemError');
            expect(new ConfigurationError('Test').name).toBe('ConfigurationError');
        });
    });
});
