import { describe, it, expect, vi, beforeEach } from 'vitest';
import { I18nextAdapter } from '@/adapters/i18nextAdapter';
import { BackendError, Backend, TranslationProvider } from '@/index';

// Type for missing key handler
type MissingKeyHandler = ((lngs: string[], ns: string, key: string, fallbackValue: string) => void) | null;

// Create mock i18next instance
function createMockI18next(overrides = {}) {
    return {
        language: 'en' as string | null | undefined,
        languages: ['en', 'de', 'fr'] as string[] | null,
        options: {
            ns: ['translation', 'common'] as string[] | null,
            missingKeyHandler: null as MissingKeyHandler,
            saveMissing: false,
        },
        getFixedT: vi.fn((_locale: string, _ns: string) => {
            return (key: string) => {
                // Simulate i18next behavior - return key if not found
                if (key === 'existing.key') return 'Existing Value';
                if (key === 'hello') return 'Hello';
                return key; // Return key if not found
            };
        }),
        addResource: vi.fn(),
        ...overrides,
    };
}

// The subset of an i18next options object the adapter saves and restores. Built with the
// keys genuinely absent — not set to `undefined` — because "the host had none" and "the host
// had `undefined`" are the two states `setupMissingKeyHandler`/`destroy` must tell apart.
type HostMissingKeyHandler = (lngs: string[], ns: string, key: string, fallbackValue: string) => void;

interface HostOptions {
    ns: string[];
    // `| undefined` so a test can hand over a host that *owns* the key holding `undefined` —
    // a different state from leaving the key out, and one the adapter has to preserve.
    missingKeyHandler?: HostMissingKeyHandler | undefined;
    saveMissing?: boolean | undefined;
}

function createLifecycleHost(options: HostOptions) {
    return {
        language: 'en',
        languages: ['en', 'de'],
        options,
        getFixedT: vi.fn((_locale: string, _ns: string) => {
            return (key: string): string => key;
        }),
        addResource: vi.fn(),
    };
}

function createMockConfig() {
    return {
        backend: Backend.I18NEXT,
        i18nInstance: {},
        localesPath: '/locales',
        defaultLanguage: 'en',
        translationProvider: {
            provider: TranslationProvider.LIBRE_TRANSLATE,
        },
        defaultNamespace: 'translation',
    };
}

describe('I18nextAdapter', () => {
    let adapter: I18nextAdapter;
    let mockI18next: ReturnType<typeof createMockI18next>;
    let mockConfig: ReturnType<typeof createMockConfig>;

    beforeEach(() => {
        adapter = new I18nextAdapter();
        mockI18next = createMockI18next();
        mockConfig = createMockConfig();
        mockConfig.i18nInstance = mockI18next;
    });

    describe('initialize', () => {
        it('should initialize with i18next instance', () => {
            expect(() => {
                adapter.initialize(mockI18next, mockConfig);
            }).not.toThrow();
        });

        it('should throw BackendError when instance is null', () => {
            expect(() => {
                adapter.initialize(null, mockConfig);
            }).toThrow(BackendError);

            expect(() => {
                adapter.initialize(null, mockConfig);
            }).toThrow('i18next instance is required');
        });

        it('should throw BackendError when instance is undefined', () => {
            expect(() => {
                adapter.initialize(undefined, mockConfig);
            }).toThrow(BackendError);
        });

        it('should enable saveMissing option', () => {
            adapter.initialize(mockI18next, mockConfig);
            expect(mockI18next.options.saveMissing).toBe(true);
        });

        it('should set up missing key handler', () => {
            adapter.initialize(mockI18next, mockConfig);
            expect(mockI18next.options.missingKeyHandler).toBeTypeOf('function');
        });

        it('should preserve original missing key handler', () => {
            const originalHandler = vi.fn();
            mockI18next.options.missingKeyHandler = originalHandler;

            adapter.initialize(mockI18next, mockConfig);

            // Trigger the handler
            mockI18next.options.missingKeyHandler!(['de'], 'translation', 'test.key', 'fallback');

            expect(originalHandler).toHaveBeenCalledWith(['de'], 'translation', 'test.key', 'fallback');
        });
    });

    describe('getTranslation', () => {
        beforeEach(() => {
            adapter.initialize(mockI18next, mockConfig);
        });

        it('should return translation for existing key', () => {
            const result = adapter.getTranslation('existing.key', 'en', 'translation');
            expect(result).toBe('Existing Value');
        });

        it('should return null for missing key', () => {
            const result = adapter.getTranslation('missing.key', 'en', 'translation');
            expect(result).toBeNull();
        });

        it('should use default namespace when not provided', () => {
            adapter.getTranslation('hello', 'en');

            expect(mockI18next.getFixedT).toHaveBeenCalledWith('en', 'translation');
        });

        it('should use provided namespace', () => {
            adapter.getTranslation('hello', 'en', 'common');

            expect(mockI18next.getFixedT).toHaveBeenCalledWith('en', 'common');
        });

        it('should return null when getFixedT throws', () => {
            mockI18next.getFixedT.mockImplementation(() => {
                throw new Error('Error');
            });

            const result = adapter.getTranslation('key', 'en');
            expect(result).toBeNull();
        });
    });

    describe('setTranslation', () => {
        beforeEach(() => {
            adapter.initialize(mockI18next, mockConfig);
        });

        it('should call addResource with correct parameters', () => {
            adapter.setTranslation('greeting', 'de', 'Hallo', 'translation');

            expect(mockI18next.addResource).toHaveBeenCalledWith('de', 'translation', 'greeting', 'Hallo');
        });

        it('should use default namespace when not provided', () => {
            adapter.setTranslation('greeting', 'de', 'Hallo');

            expect(mockI18next.addResource).toHaveBeenCalledWith('de', 'translation', 'greeting', 'Hallo');
        });

        it('should throw BackendError when addResource fails', () => {
            mockI18next.addResource.mockImplementation(() => {
                throw new Error('Failed');
            });

            expect(() => {
                adapter.setTranslation('greeting', 'de', 'Hallo');
            }).toThrow(BackendError);
        });
    });

    describe('onMissingKey', () => {
        beforeEach(() => {
            adapter.initialize(mockI18next, mockConfig);
        });

        it('should register callback for missing keys', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            // Trigger the missing key handler
            mockI18next.options.missingKeyHandler!(['de'], 'translation', 'test.key', 'fallback');

            expect(callback).toHaveBeenCalledWith('test.key', 'de', 'translation');
        });

        it('should use first language from array', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            mockI18next.options.missingKeyHandler!(['de', 'en', 'fr'], 'common', 'key', 'fallback');

            expect(callback).toHaveBeenCalledWith('key', 'de', 'common');
        });

        it('should not call callback if not registered', () => {
            // Just verify no error is thrown when handler is called without callback
            expect(() => {
                mockI18next.options.missingKeyHandler!(['de'], 'translation', 'test.key', 'fallback');
            }).not.toThrow();
        });
    });

    describe('destroy', () => {
        // Assertions here are on key *presence*, not on the value: writing `undefined` over a key
        // the host never had and removing it again are indistinguishable through `toBeUndefined()`,
        // and removing it is the behaviour the adapter promises.

        it('should restore a missingKeyHandler the host already had', () => {
            const originalHandler = vi.fn();
            const host = createLifecycleHost({ ns: ['translation'], missingKeyHandler: originalHandler });

            adapter.initialize(host, mockConfig);
            expect(host.options.missingKeyHandler).not.toBe(originalHandler);

            adapter.destroy();

            expect(host.options.missingKeyHandler).toBe(originalHandler);
        });

        it('should leave missingKeyHandler absent when the host had none', () => {
            const host = createLifecycleHost({ ns: ['translation'] });

            adapter.initialize(host, mockConfig);
            expect('missingKeyHandler' in host.options).toBe(true);

            adapter.destroy();

            expect('missingKeyHandler' in host.options).toBe(false);
        });

        it('should restore a saveMissing the host already had', () => {
            const host = createLifecycleHost({ ns: ['translation'], saveMissing: false });

            adapter.initialize(host, mockConfig);
            expect(host.options.saveMissing).toBe(true);

            adapter.destroy();

            expect('saveMissing' in host.options).toBe(true);
            expect(host.options.saveMissing).toBe(false);
        });

        it('should leave saveMissing absent when the host had none', () => {
            const host = createLifecycleHost({ ns: ['translation'] });

            adapter.initialize(host, mockConfig);
            expect(host.options.saveMissing).toBe(true);

            adapter.destroy();

            expect('saveMissing' in host.options).toBe(false);
        });

        it('should restore a missingKeyHandler the host owned as undefined', () => {
            const host = createLifecycleHost({ ns: ['translation'], missingKeyHandler: undefined });

            adapter.initialize(host, mockConfig);
            adapter.destroy();

            // The host owned the key, so it gets the key back — not the absence the adapter
            // hands a host that never set it.
            expect('missingKeyHandler' in host.options).toBe(true);
            expect(host.options.missingKeyHandler).toBeUndefined();
        });

        it('should restore a saveMissing the host owned as undefined', () => {
            const host = createLifecycleHost({ ns: ['translation'], saveMissing: undefined });

            adapter.initialize(host, mockConfig);
            expect(host.options.saveMissing).toBe(true);

            adapter.destroy();

            expect('saveMissing' in host.options).toBe(true);
            expect(host.options.saveMissing).toBeUndefined();
        });

        it('should keep saveMissing false across an initialize/destroy round trip', () => {
            const host = createLifecycleHost({ ns: ['translation'], saveMissing: false });

            adapter.initialize(host, mockConfig);
            adapter.destroy();

            const secondAdapter = new I18nextAdapter();
            secondAdapter.initialize(host, mockConfig);
            expect(host.options.saveMissing).toBe(true);

            secondAdapter.destroy();

            expect('saveMissing' in host.options).toBe(true);
            expect(host.options.saveMissing).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('should handle empty namespace configuration', () => {
            delete (mockConfig as { defaultNamespace?: string }).defaultNamespace;
            adapter.initialize(mockI18next, mockConfig);

            adapter.getTranslation('key', 'en');

            expect(mockI18next.getFixedT).toHaveBeenCalledWith('en', 'translation');
        });

        it('should handle nested keys', () => {
            mockI18next.getFixedT.mockReturnValue((key: string) => {
                if (key === 'user.profile.name') return 'Name';
                return key;
            });

            adapter.initialize(mockI18next, mockConfig);

            const result = adapter.getTranslation('user.profile.name', 'en');
            expect(result).toBe('Name');
        });
    });
});
