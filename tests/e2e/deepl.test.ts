/**
 * E2E Test - Translate API metadata and save to language files
 *
 * Run with:
 *   DEEPL_API_KEY=your-key npm run test:deepl-e2e
 *
 * Or define the API keys in a .env.dev file at the project root
 */

import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import i18next from 'i18next';
import { I18n } from 'i18n';
import * as fs from 'fs';
import * as path from 'path';
import { AutoTranslate, Backend, TranslationProvider, FileFormat } from '@/index';
import { config } from 'dotenv';
import {
    loadLocaleResources,
    readJsonFile,
    writeJsonFile,
    getNestedValue,
    deleteNestedKey,
    translateObjectAndReadFile,
    fetchExistingTranslationsWithSpy,
    TranslationFixture,
} from './util';
import { http } from '@/utils/http';
import { DeepLModelType } from '@/types';

// Load environment variables from .env file
config({ path: path.join(__dirname, '../..', '.env.dev') });

const I18NEXT_LOCALES_PATH = path.join(__dirname, '..', 'fixtures', 'i18next-locales');
const NODE_I18N_LOCALES_PATH = path.join(__dirname, '..', 'fixtures', 'node-i18n-locales');
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const hasApi = Boolean(DEEPL_API_KEY);

// Test Data
const apiData = {
    product: {
        meta: {
            category: 'Electronics',
            brand: 'SoundMagic',
            shippingTime: '3-5 business days',
        },
    },
};

const batTranslations: TranslationFixture[] = [
    {
        key: 'bat',
        parentKey: 'products.metaData.ecommerce',
        expectedValue: 'Schläger',
        context: 'sports equipment e-commerce',
    },
    { key: 'bat', parentKey: 'products.metaData.nature', expectedValue: 'Fledermaus', context: 'nature animals' },
];

// i18next Tests
describe.skipIf(!hasApi)('E2E: i18next - Translate API metadata', () => {
    let autoTranslate: AutoTranslate;

    beforeAll(async () => {
        const resources = loadLocaleResources(I18NEXT_LOCALES_PATH, ['en', 'de', 'es'], ['products']);

        await i18next.init({
            lng: 'en',
            fallbackLng: 'en',
            ns: ['products'],
            defaultNS: 'products',
            resources,
            saveMissing: true,
        });

        autoTranslate = new AutoTranslate({
            backend: Backend.I18NEXT,
            i18nInstance: i18next,
            localesPath: I18NEXT_LOCALES_PATH,
            defaultLanguage: 'en',
            translationProvider: {
                provider: TranslationProvider.DEEPL,
                apiKey: DEEPL_API_KEY,
                deeplOptions: { formality: 'prefer_more', context: 'e-commerce', modelType: DeepLModelType.QUALITY },
            },
            autoSave: true,
            fileFormat: FileFormat.JSON,
        });
    });

    afterAll(async () => {
        await autoTranslate?.dispose();
        // Clean up test-generated keys
        for (const lang of ['de', 'es']) {
            const filePath = path.join(I18NEXT_LOCALES_PATH, lang, 'products.json');
            if (fs.existsSync(filePath)) {
                const data = readJsonFile(filePath);
                deleteNestedKey(data, 'products.meta');
                writeJsonFile(filePath, data);
            }
        }
    });

    afterEach(() => vi.restoreAllMocks());

    it('should translate API metadata to German', async () => {
        const httpSpy = vi.spyOn(http, 'post');

        const { translations, savedData, savedTranslations } = await translateObjectAndReadFile({
            autoTranslate,
            sourceData: apiData.product.meta,
            targetLocale: 'de',
            namespace: 'products',
            parentKey: 'products.meta',
            localeFilePath: path.join(I18NEXT_LOCALES_PATH, 'de', 'products.json'),
        });

        // Verify translations were returned and differ from source
        for (const key of Object.keys(apiData.product.meta)) {
            expect(translations[key]).toBeTruthy();
            expect(translations[key]).not.toBe(apiData.product.meta[key as keyof typeof apiData.product.meta]);
        }

        // Verify translations were saved to file
        expect(savedTranslations).toBeDefined();
        for (const key of Object.keys(apiData.product.meta)) {
            expect(savedTranslations[key]).toBeDefined();
            expect(savedTranslations[key]).not.toBe(apiData.product.meta[key as keyof typeof apiData.product.meta]);
        }

        // Verify API was called with batch of 3 texts
        expect(httpSpy).toHaveBeenCalledTimes(1);
        const data = httpSpy.mock.calls[0][1] as Record<string, any>;
        expect(data.text).toHaveLength(3);

        console.log('Saved translations (DE):', JSON.stringify(savedData, null, 2));
    }, 60000);

    it('should translate API metadata to Spanish', async () => {
        const { translations, savedData, savedTranslations } = await translateObjectAndReadFile({
            autoTranslate,
            sourceData: apiData.product.meta,
            targetLocale: 'es',
            namespace: 'products',
            parentKey: 'products.meta',
            localeFilePath: path.join(I18NEXT_LOCALES_PATH, 'es', 'products.json'),
        });

        // Verify translations were returned and differ from source
        for (const key of Object.keys(apiData.product.meta)) {
            expect(translations[key]).toBeTruthy();
            expect(translations[key]).not.toBe(apiData.product.meta[key as keyof typeof apiData.product.meta]);
        }

        // Verify translations were saved to file
        expect(savedTranslations).toBeDefined();
        for (const key of Object.keys(apiData.product.meta)) {
            expect(savedTranslations[key]).toBeDefined();
            expect(savedTranslations[key]).not.toBe(apiData.product.meta[key as keyof typeof apiData.product.meta]);
        }

        console.log('Saved translations (ES):', JSON.stringify(savedData, null, 2));
    }, 60000);

    it('should translate differently depending on context', async () => {
        const ecommerce = await autoTranslate.translateKey('bat', 'de', {
            namespace: 'products',
            parentKey: 'products.metaData.ecommerce',
            context: 'sports equipment e-commerce',
        });

        const nature = await autoTranslate.translateKey('bat', 'de', {
            namespace: 'products',
            parentKey: 'products.metaData.nature',
            context: 'nature animals',
        });

        expect(ecommerce).toBeTruthy();
        expect(nature).toBeTruthy();
        expect(ecommerce).not.toBe(nature);

        console.log('E-commerce context:', ecommerce);
        console.log('Nature context:', nature);
    });

    it('should return existing translations without calling the API', async () => {
        const fixtures = batTranslations.map((t) => ({ ...t, namespace: 'products' }));
        const { fixtureData, results, httpSpy } = await fetchExistingTranslationsWithSpy({
            autoTranslate,
            localeFilePath: path.join(I18NEXT_LOCALES_PATH, 'de', 'products.json'),
            translations: fixtures,
            targetLocale: 'de',
        });

        // Verify translations exist in fixture
        for (const { parentKey, key, expectedValue } of fixtures) {
            expect(getNestedValue(fixtureData, `${parentKey}.${key}`)).toBe(expectedValue);
        }

        // Verify correct values returned
        for (let i = 0; i < fixtures.length; i++) {
            expect(results[i]).toBe(fixtures[i].expectedValue);
            console.log(`Existing translation (${fixtures[i].parentKey}.${fixtures[i].key}):`, results[i]);
        }

        // Verify API was not called
        expect(httpSpy).not.toHaveBeenCalled();
        httpSpy.mockRestore();
    });
});

// i18next Automatic Missing Key Tests
describe.skipIf(!hasApi)('E2E: i18next - Automatic missing key translation', () => {
    let autoTranslate: AutoTranslate;
    let i18nextInstance: typeof i18next;

    beforeAll(async () => {
        // Create a fresh i18next instance for this test suite
        i18nextInstance = i18next.createInstance();

        const resources = loadLocaleResources(I18NEXT_LOCALES_PATH, ['en', 'de'], ['translation']);

        await i18nextInstance.init({
            lng: 'en',
            fallbackLng: false, // Disable fallback so missing keys trigger missingKeyHandler
            ns: ['translation'],
            defaultNS: 'translation',
            resources,
            saveMissing: true,
        });

        autoTranslate = new AutoTranslate({
            backend: Backend.I18NEXT,
            i18nInstance: i18nextInstance,
            localesPath: I18NEXT_LOCALES_PATH,
            defaultLanguage: 'en',
            defaultNamespace: 'translation',
            translationProvider: {
                provider: TranslationProvider.DEEPL,
                apiKey: DEEPL_API_KEY,
                deeplOptions: {
                    formality: 'prefer_more',
                    context: 'web-app',
                },
            },
            autoSave: true,
            fileFormat: FileFormat.JSON,
        });
    });

    afterAll(async () => {
        await autoTranslate?.dispose();
        // Clean up test-generated keys
        const filePath = path.join(I18NEXT_LOCALES_PATH, 'de', 'translation.json');
        if (fs.existsSync(filePath)) {
            const data = readJsonFile(filePath);
            delete data['welcomeMessage'];
            delete data['goodbyeMessage'];
            writeJsonFile(filePath, data);
        }
    });

    afterEach(() => vi.restoreAllMocks());

    it('should automatically translate when i18next encounters a missing key', async () => {
        const httpSpy = vi.spyOn(http, 'post');
        await i18nextInstance.changeLanguage('de');

        // Request a translation for a key that doesn't exist
        // This triggers i18next's missingKeyHandler which AutoTranslate hooks into
        const startTime = Date.now();
        i18nextInstance.t('welcomeMessage');
        i18nextInstance.t('goodbyeMessage'); // Request another to test batching

        // Wait for async translation to complete
        await autoTranslate.waitForPendingTranslations();
        const duration = Date.now() - startTime;

        // Verify the translation was saved to the file
        const savedData = readJsonFile(path.join(I18NEXT_LOCALES_PATH, 'de', 'translation.json'));
        expect(savedData['welcomeMessage']).toBeDefined();
        expect(savedData['welcomeMessage']).not.toBe('welcomeMessage');
        expect(savedData['welcomeMessage']).not.toBe('welcome message');

        // Verify API was called (should be only 1 call due to batching)
        expect(httpSpy).toHaveBeenCalledTimes(1);

        console.log(`Auto-translated 2 missing keys in ${duration}ms:`, savedData['welcomeMessage']);
        httpSpy.mockRestore();
    }, 30000);

    it('should not call API for subsequent requests of the same missing key', async () => {
        const httpSpy = vi.spyOn(http, 'post');
        await i18nextInstance.changeLanguage('de');

        // Request the same key that was translated in previous test
        // It should already exist in the file
        i18nextInstance.t('goodbyeMessage');

        // Wait for any potential async processing
        await autoTranslate.waitForPendingTranslations();

        // API should not be called - translation already exists
        expect(httpSpy).not.toHaveBeenCalled();

        httpSpy.mockRestore();
    }, 30000);
});

// node-i18n Tests
describe.skipIf(!hasApi)('E2E: node-i18n - Translate API metadata', () => {
    let autoTranslate: AutoTranslate;
    let i18n: I18n;

    beforeAll(() => {
        i18n = new I18n({
            locales: ['en', 'de', 'es'],
            defaultLocale: 'en',
            directory: NODE_I18N_LOCALES_PATH,
            objectNotation: true,
            updateFiles: false,
        });

        autoTranslate = new AutoTranslate({
            backend: Backend.NODE_I18N,
            i18nInstance: i18n,
            localesPath: NODE_I18N_LOCALES_PATH,
            defaultLanguage: 'en',
            translationProvider: {
                provider: TranslationProvider.DEEPL,
                apiKey: DEEPL_API_KEY,
                deeplOptions: { formality: 'prefer_more', context: 'e-commerce' },
            },
            autoSave: true,
            fileFormat: FileFormat.JSON,
            objectNotation: true,
        });
    });

    afterAll(async () => {
        await autoTranslate?.dispose();
        // Clean up test-generated keys
        for (const lang of ['de', 'es']) {
            const filePath = path.join(NODE_I18N_LOCALES_PATH, `${lang}.json`);
            if (fs.existsSync(filePath)) {
                const data = readJsonFile(filePath);
                deleteNestedKey(data, 'products.meta');
                writeJsonFile(filePath, data, true);
            }
        }
    });

    afterEach(() => vi.restoreAllMocks());

    it('should translate a single key to German', async () => {
        const translation = await autoTranslate.translateKey('category', 'de', {
            parentKey: 'products.meta',
        });

        expect(translation).toBeTruthy();
        expect(translation).not.toBe('category');
        expect(translation).not.toBe('Category');

        const savedData = readJsonFile(path.join(NODE_I18N_LOCALES_PATH, 'de.json'));
        expect(getNestedValue(savedData, 'products.meta.category')).toBe(translation);

        console.log('node-i18n - Saved translation (DE):', translation);
    }, 60000);

    it('should translate a single key to Spanish', async () => {
        const translation = await autoTranslate.translateKey('brand', 'es', {
            parentKey: 'products.meta',
        });

        expect(translation).toBeTruthy();
        expect(translation).not.toBe('brand');
        expect(translation).not.toBe('Brand');

        const savedData = readJsonFile(path.join(NODE_I18N_LOCALES_PATH, 'es.json'));
        expect(getNestedValue(savedData, 'products.meta.brand')).toBe(translation);

        console.log('node-i18n - Saved translation (ES):', translation);
    }, 60000);

    it('should return existing translations without calling the API', async () => {
        const { fixtureData, results, httpSpy } = await fetchExistingTranslationsWithSpy({
            autoTranslate,
            localeFilePath: path.join(NODE_I18N_LOCALES_PATH, 'de.json'),
            translations: batTranslations,
            targetLocale: 'de',
        });

        // Verify translations exist in fixture
        for (const { parentKey, key, expectedValue } of batTranslations) {
            expect(getNestedValue(fixtureData, `${parentKey}.${key}`)).toBe(expectedValue);
        }

        // Verify correct values returned
        for (let i = 0; i < batTranslations.length; i++) {
            expect(results[i]).toBe(batTranslations[i].expectedValue);
            console.log(
                `Existing translation (${batTranslations[i].parentKey}.${batTranslations[i].key}):`,
                results[i]
            );
        }

        // Verify API was not called
        expect(httpSpy).not.toHaveBeenCalled();
        httpSpy.mockRestore();
    });
});

// node-i18n Automatic Missing Key Tests
describe.skipIf(!hasApi)('E2E: node-i18n - Automatic missing key translation', () => {
    let autoTranslate: AutoTranslate;
    let i18n: I18n;

    beforeAll(() => {
        i18n = new I18n({
            locales: ['en', 'de'],
            defaultLocale: 'en',
            directory: NODE_I18N_LOCALES_PATH,
            objectNotation: true,
            updateFiles: false,
        });

        autoTranslate = new AutoTranslate({
            backend: Backend.NODE_I18N,
            i18nInstance: i18n,
            localesPath: NODE_I18N_LOCALES_PATH,
            defaultLanguage: 'en',
            translationProvider: {
                provider: TranslationProvider.DEEPL,
                apiKey: DEEPL_API_KEY,
                deeplOptions: { formality: 'prefer_more' },
            },
            autoSave: true,
            fileFormat: FileFormat.JSON,
            objectNotation: true,
        });
    });

    afterAll(async () => {
        await autoTranslate?.dispose();
        // Clean up test-generated keys
        const filePath = path.join(NODE_I18N_LOCALES_PATH, 'de.json');
        if (fs.existsSync(filePath)) {
            const data = readJsonFile(filePath);
            delete data['helloWorld'];
            delete data['thankYou'];
            writeJsonFile(filePath, data, true);
        }
    });

    afterEach(() => vi.restoreAllMocks());

    it('should automatically translate when node-i18n encounters a missing key', async () => {
        const httpSpy = vi.spyOn(http, 'post');

        // Set locale to German
        i18n.setLocale('de');

        // Request translations for keys that don't exist in German
        const startTime = Date.now();
        i18n.__('helloWorld');
        i18n.__('thankYou');

        // Wait for async translation to complete
        await autoTranslate.waitForPendingTranslations();
        const duration = Date.now() - startTime;

        // Verify the translations were saved to the file
        const savedData = readJsonFile(path.join(NODE_I18N_LOCALES_PATH, 'de.json'));
        expect(savedData['helloWorld']).toBeDefined();
        expect(savedData['helloWorld']).not.toBe('helloWorld');
        expect(savedData['thankYou']).toBeDefined();
        expect(savedData['thankYou']).not.toBe('thankYou');

        // Verify API was called (should be only 1 call due to batching)
        expect(httpSpy).toHaveBeenCalledTimes(1);

        console.log(
            `node-i18n: Auto-translated 2 missing keys in ${duration}ms:`,
            savedData['helloWorld'],
            savedData['thankYou']
        );
        httpSpy.mockRestore();
    }, 30000);

    it('should automatically translate when user changes language', async () => {
        const httpSpy = vi.spyOn(http, 'post');

        // Start in English (default)
        i18n.setLocale('en');

        // User changes to German
        i18n.setLocale('de');

        // Request a translation - simulating a page render after language change
        const startTime = Date.now();
        i18n.__('welcomeBack'); // A key that exists in English but not German

        await autoTranslate.waitForPendingTranslations();
        const duration = Date.now() - startTime;

        // Verify translation was created
        const savedData = readJsonFile(path.join(NODE_I18N_LOCALES_PATH, 'de.json'));
        expect(savedData['welcomeBack']).toBeDefined();
        expect(savedData['welcomeBack']).not.toBe('welcomeBack');

        console.log(`node-i18n: Language switch translation in ${duration}ms:`, savedData['welcomeBack']);
        httpSpy.mockRestore();

        // Clean up
        delete savedData['welcomeBack'];
        writeJsonFile(path.join(NODE_I18N_LOCALES_PATH, 'de.json'), savedData, true);
    }, 30000);

    it('should not call API for subsequent requests of the same missing key', async () => {
        const httpSpy = vi.spyOn(http, 'post');

        i18n.setLocale('de');

        // Request the same keys that were translated in the first test
        i18n.__('helloWorld');
        i18n.__('thankYou');

        await autoTranslate.waitForPendingTranslations();

        // API should not be called - translations already exist
        expect(httpSpy).not.toHaveBeenCalled();

        httpSpy.mockRestore();
    }, 30000);
});
