/**
 * A consumer of the published package, compiled against the built `dist/`.
 *
 * The point is not what this code does — it is that the shipped declarations
 * type-check under every TypeScript version the README claims to support. The
 * compat job compiles this file against the floor and the current compiler, so
 * the badge stops being a hand-written promise.
 *
 * Touch one member of every exported type a consumer would realistically name.
 */
import {
    AutoTranslate,
    AutoTranslateMode,
    CacheStats,
    StorageAdapter,
    StorageSaveEntry,
    TranslationCache,
    TranslationIdentity,
} from '../../dist/index';

const cache: TranslationCache = {
    get: (identity: TranslationIdentity): string | null => (identity.locale === 'de' ? 'hallo' : null),
    set: (identity: TranslationIdentity, value: string): void => {
        void identity;
        void value;
    },
    has: (identity: TranslationIdentity): boolean => identity.key.length > 0,
    clear: (): void => {},
    getStats: (): CacheStats => ({ size: 0 }),
};

const storage: StorageAdapter = {
    save: async (locale: string, key: string, value: string, options?: { namespace?: string; parentKey?: string }) => {
        void [locale, key, value, options?.namespace, options?.parentKey];
    },
    saveBatch: async (entries: StorageSaveEntry[]): Promise<void> => {
        void entries.length;
    },
};

const mode: AutoTranslateMode = 'production';

export function describe(instance: AutoTranslate): string {
    const stats: CacheStats | null = instance.getCacheStats();
    return `${mode}:${stats?.size ?? 0}:${instance.isDisposed()}`;
}

export const wiring = { cache, storage };
