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

        it('should not stack the missing-key hook on a second initialize call', () => {
            adapter.initialize(mockI18next, mockConfig);
            const handlerAfterFirstCall = mockI18next.options.missingKeyHandler;

            // Guarded by `this.initialized` — a second call must leave the hook exactly as the
            // first call installed it, not wrap it again.
            adapter.initialize(mockI18next, mockConfig);

            expect(mockI18next.options.missingKeyHandler).toBe(handlerAfterFirstCall);
        });
    });

    describe('setupMissingKeyHandler guard', () => {
        it('does nothing when called without an i18next instance', () => {
            // Unreachable through the public API: initialize() already validates the instance
            // before calling this, so the guard never fires on a path a caller can reach. Called
            // directly, through a cast that drops the private modifier, to prove the guard itself.
            const uncalledAdapter = new I18nextAdapter() as unknown as { setupMissingKeyHandler: () => void };

            expect(() => uncalledAdapter.setupMissingKeyHandler()).not.toThrow();
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

        it('should return null when getFixedT resolves to a non-string value', () => {
            // Real i18next's `getFixedT` returns a `TFunction` whose result is `unknown` when a
            // `returnObjects`/`returnedObjectHandler` config is in play — the mock factory above
            // narrows it to `string` for every other test, so this one case needs its own cast to
            // exercise what the real package's type actually allows.
            const returnsUndefined = (): ((key: string) => string) =>
                (() => undefined) as unknown as (key: string) => string;
            mockI18next.getFixedT.mockImplementation(returnsUndefined);

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

        it('should wrap a non-Error thrown by addResource', () => {
            mockI18next.addResource.mockImplementation(() => {
                // eslint-disable-next-line @typescript-eslint/no-throw-literal
                throw 'boom';
            });

            expect(() => {
                adapter.setTranslation('greeting', 'de', 'Hallo');
            }).toThrow('Failed to set translation in i18next: boom');
        });

        it('should fall back to the literal namespace "translation" when neither a namespace nor a default is configured', () => {
            delete (mockConfig as { defaultNamespace?: string }).defaultNamespace;

            adapter.setTranslation('greeting', 'de', 'Hallo');

            expect(mockI18next.addResource).toHaveBeenCalledWith('de', 'translation', 'greeting', 'Hallo');
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

        it('should not call the callback when the handler receives no languages', () => {
            const callback = vi.fn();
            adapter.onMissingKey(callback);

            // i18next always hands the handler an array; a host-supplied
            // missingKeyHandler wrapper that forwards nothing is what `?? []` guards.
            expect(() => {
                mockI18next.options.missingKeyHandler!(
                    undefined as unknown as string[],
                    'translation',
                    'test.key',
                    'fallback'
                );
            }).not.toThrow();

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('reportError', () => {
        beforeEach(() => {
            adapter.initialize(mockI18next, mockConfig);
        });

        it('should fall back to console.error when no onError hook is configured', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((): void => {});
            try {
                const rejection = new Error('callback failed');
                adapter.onMissingKey(() => Promise.reject(rejection));

                mockI18next.options.missingKeyHandler!(['de'], 'translation', 'test.key', 'fallback');

                await vi.waitFor(() => {
                    expect(consoleErrorSpy).toHaveBeenCalled();
                });
                expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('test.key'), rejection);
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });

        it('should route to the configured onError hook instead of the console', async () => {
            const onError = vi.fn();
            const configWithOnError = { ...mockConfig, onError };
            const routedAdapter = new I18nextAdapter();
            const routedI18next = createMockI18next();
            routedAdapter.initialize(routedI18next, configWithOnError);

            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((): void => {});
            try {
                const rejection = new Error('callback failed');
                routedAdapter.onMissingKey(() => Promise.reject(rejection));

                routedI18next.options.missingKeyHandler!(['de'], 'translation', 'test.key', 'fallback');

                await vi.waitFor(() => {
                    expect(onError).toHaveBeenCalledWith(rejection, 'test.key', 'de');
                });
                expect(consoleErrorSpy).not.toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
            }
        });
    });

    describe('before initialize', () => {
        it('disagrees across the three lifecycle methods: setTranslation throws, getTranslation misses, destroy no-ops', () => {
            const uninitializedAdapter = new I18nextAdapter();

            // The message, not just the class: `BackendError` alone would also be satisfied by
            // the `catch` in `setTranslation` wrapping the `TypeError` an absent instance raises,
            // so a guard-less adapter would pass an assertion on the type. Only the message tells
            // "refused because there is no backend" apart from "the backend refused".
            expect(() => uninitializedAdapter.setTranslation('key', 'en', 'value')).toThrow(BackendError);
            expect(() => uninitializedAdapter.setTranslation('key', 'en', 'value')).toThrow(
                'i18next adapter not initialized'
            );

            // `getTranslation`'s guard has no such tell: with it gone, `getFixedT` throws inside
            // the method's own `try` and the `catch` answers `null` as well. The contract — a read
            // with nothing behind it is a miss, not a failure — is asserted; the line that
            // implements it cannot be pinned through the public API, and is kept for the same
            // reason the i18n-node adapter keeps its twin: a miss should not travel as an
            // exception.
            expect(uninitializedAdapter.getTranslation('key', 'en')).toBeNull();
            expect(() => uninitializedAdapter.destroy()).not.toThrow();
        });
    });

    describe('destroy', () => {
        // Assertions here are on key *presence*, not on the value: writing `undefined` over a key
        // the host never had and removing it again are indistinguishable through `toBeUndefined()`,
        // and removing it is the behaviour the adapter promises. Only the two "had none" cases can
        // tell presence tracking apart from the value tracking that came before it — the two
        // "owned as undefined" cases below pin the other half of the same bookkeeping, and a
        // value-tracking adapter happens to satisfy them as well.

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
            // hands a host that never set it. This is the arm that must not regress when the
            // "had none" case above is fixed; it does not by itself prove presence tracking.
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

        it('should not adopt an options key the host merely inherits', () => {
            const prototype = { saveMissing: false };
            const options: HostOptions = Object.assign(Object.create(prototype) as HostOptions, {
                ns: ['translation'],
            });
            const host = createLifecycleHost(options);

            expect(Object.prototype.hasOwnProperty.call(host.options, 'saveMissing')).toBe(false);

            adapter.initialize(host, mockConfig);
            adapter.destroy();

            // The host never *owned* the key, so taking it away has to expose the prototype's
            // value again rather than pinning an own copy of it onto the options object.
            expect(Object.prototype.hasOwnProperty.call(host.options, 'saveMissing')).toBe(false);
            expect(host.options.saveMissing).toBe(false);
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

        it('should treat a second destroy() as a no-op', () => {
            // `docs/conventions/concurrency.md` states it; nothing asserted it until now. The
            // host assertions are the substance: a second call that ran would find
            // `hadMissingKeyHandler` back at `false` and delete the handler it had just restored.
            const originalHandler = vi.fn();
            const host = createLifecycleHost({
                ns: ['translation'],
                missingKeyHandler: originalHandler,
                saveMissing: false,
            });

            adapter.initialize(host, mockConfig);
            adapter.destroy();
            expect(host.options.missingKeyHandler).toBe(originalHandler);

            expect(() => adapter.destroy()).not.toThrow();

            expect(host.options.missingKeyHandler).toBe(originalHandler);
            expect('saveMissing' in host.options).toBe(true);
            expect(host.options.saveMissing).toBe(false);
        });

        it('should re-attach when initialize() is called again on the same adapter', () => {
            // Not the same as the round trip above, which hands the host to a *second* adapter.
            // Re-using the one instance only works if destroy() cleared `initialized`; otherwise
            // the second initialize() returns on its own double-init guard and the host is left
            // unhooked, with no exception to say so.
            const host = createLifecycleHost({ ns: ['translation'] });

            adapter.initialize(host, mockConfig);
            adapter.destroy();
            expect('missingKeyHandler' in host.options).toBe(false);

            adapter.initialize(host, mockConfig);

            expect(host.options.missingKeyHandler).toBeTypeOf('function');
            expect(host.options.saveMissing).toBe(true);

            const callback = vi.fn();
            adapter.onMissingKey(callback);
            host.options.missingKeyHandler?.(['de'], 'translation', 'test.key', 'fallback');
            expect(callback).toHaveBeenCalledWith('test.key', 'de', 'translation');

            // And the re-attached hook comes off again on the next destroy().
            adapter.destroy();

            expect('missingKeyHandler' in host.options).toBe(false);
            expect('saveMissing' in host.options).toBe(false);
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
