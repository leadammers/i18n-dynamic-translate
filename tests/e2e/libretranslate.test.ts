/**
 * E2E Test - LibreTranslate against a live instance
 *
 * Self-skips unless LIBRETRANSLATE_URL points at a running instance. Start one with:
 *
 *   docker run --rm -p 5555:5000 -e LT_LOAD_ONLY=en,de libretranslate/libretranslate
 *   LIBRETRANSLATE_URL=http://127.0.0.1:5555/translate npm run test:libre-e2e
 *
 * `LT_LOAD_ONLY` keeps the model download to the one language pair these tests use.
 *
 * Unlike the DeepL suite this needs no credentials — which is the point: the provider
 * contract (array batching, response shape, error body) is only observable against a
 * real server, and a stub written from our own assumptions cannot falsify them.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import i18next from 'i18next';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AutoTranslate, Backend, TranslationProvider, FileFormat } from '@/index';
import { http } from '@/utils/http';

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL;
const hasInstance = Boolean(LIBRETRANSLATE_URL);

/** Only read while the suite runs, and the suite only runs when the variable is set. */
const apiUrl = LIBRETRANSLATE_URL ?? 'http://libretranslate.invalid/translate';

/** German for 'Welcome Message' — the instance is deterministic for this pair. */
const SOURCE_KEY = 'welcomeMessage';

function createInstance(localesPath: string): AutoTranslate {
    return new AutoTranslate({
        backend: Backend.I18NEXT,
        i18nInstance: i18next,
        localesPath,
        defaultLanguage: 'en',
        fileFormat: FileFormat.JSON,
        autoSave: true,
        translationProvider: {
            provider: TranslationProvider.LIBRE_TRANSLATE,
            apiUrl,
        },
    });
}

describe.skipIf(!hasInstance)('E2E: LibreTranslate', () => {
    const createdDirs: string[] = [];

    beforeAll(async () => {
        await i18next.init({ lng: 'de', fallbackLng: 'de', resources: { de: { translation: {} } } });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        while (createdDirs.length > 0) {
            const dir = createdDirs.pop();
            if (dir) fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function trackedLocalesDir(fileName: string): string {
        const localesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'libre-e2e-'));
        fs.writeFileSync(path.join(localesPath, fileName), '{}\n');
        createdDirs.push(localesPath);
        return localesPath;
    }

    it('translates a single key, writes it back and persists it', async () => {
        const localesPath = trackedLocalesDir('de.json');
        const autoTranslate = createInstance(localesPath);

        try {
            const translated = await autoTranslate.translateKey(SOURCE_KEY, 'de');

            expect(translated).toBe('Willkommensnachricht');
            expect(i18next.getFixedT('de', 'translation')(SOURCE_KEY)).toBe('Willkommensnachricht');

            const persisted = JSON.parse(fs.readFileSync(path.join(localesPath, 'de.json'), 'utf-8'));
            expect(persisted[SOURCE_KEY]).toBe('Willkommensnachricht');
        } finally {
            await autoTranslate.dispose();
        }
    });

    it('sends a whole batch as one request and keeps the order', async () => {
        // The reason this suite exists: LibreTranslate accepts `q` as an array, and
        // a stub written from our own assumptions could never have shown that.
        const localesPath = trackedLocalesDir('de.json');
        const autoTranslate = createInstance(localesPath);
        const postSpy = vi.spyOn(http, 'post');

        try {
            const result = await autoTranslate.translateObject(
                { carrier: 'x', weight: 'x', shippingTime: 'x', brand: 'x' },
                'de'
            );

            expect(result).toEqual({
                carrier: 'Beförderer',
                weight: 'Gewicht',
                shippingTime: 'Versandzeit',
                brand: 'Marke',
            });
            expect(postSpy).toHaveBeenCalledTimes(1);
        } finally {
            await autoTranslate.dispose();
        }
    });

    it('reports an unsupported target language without leaking the request', async () => {
        const localesPath = trackedLocalesDir('zz.json');
        const autoTranslate = createInstance(localesPath);

        try {
            // A key no other test translates. `fallbackLng` is `de`, so a key this
            // suite has already filled would be answered from the fallback catalog
            // and never reach the provider at all.
            const rejection = await autoTranslate.translateKey('unsupportedProbe', 'zz').then(
                () => undefined,
                (error: unknown) => error
            );

            expect(rejection).toBeInstanceOf(Error);
            const message = (rejection as Error).message;
            expect(message).toMatch(/LibreTranslate API/);
            expect(message).not.toContain(apiUrl);
            expect(message).not.toContain('unsupportedProbe');
        } finally {
            await autoTranslate.dispose();
        }
    });
});
