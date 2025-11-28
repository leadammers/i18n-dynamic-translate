/**
 * E2E Test - Translate API metadata and save to language files
 *
 * Run with:
 *   DEEPL_API_KEY=your-key npm run test:deepl-e2e
 *
 * Or define the API keys in a .env.dev file at the project root.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// Load environment variables from .env file
config({ path: path.join(__dirname, '../..', '.env.dev') });

const I18NEXT_LOCALES_PATH = path.join(__dirname, '..', 'fixtures', 'i18next-locales');
const NODE_I18N_LOCALES_PATH = path.join(__dirname, '..', 'fixtures', 'node-i18n-locales');
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const hasApi = !!DEEPL_API_KEY;

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
                deeplOptions: { formality: 'prefer_more', context: 'e-commerce' },
            },
            autoSave: true,
            fileFormat: FileFormat.JSON,
        });
    });

    afterAll(() => {
        autoTranslate?.dispose();
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

    it('should translate API metadata to German', async () => {
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
        const ecommerce = await autoTranslate.translateKey(
            'bat',
            'de',
            {
                namespace: 'products',
                parentKey: 'products.metaData.ecommerce',
            },
            'sports equipment e-commerce'
        );

        const nature = await autoTranslate.translateKey(
            'bat',
            'de',
            {
                namespace: 'products',
                parentKey: 'products.metaData.nature',
            },
            'nature animals'
        );

        expect(ecommerce).toBeTruthy();
        expect(nature).toBeTruthy();
        expect(ecommerce).not.toBe(nature);

        console.log('E-commerce context:', ecommerce);
        console.log('Nature context:', nature);
    });

    it('should return existing translations without calling the API', async () => {
        const fixtures = batTranslations.map((t) => ({ ...t, namespace: 'products' }));
        const { fixtureData, results, axiosSpy } = await fetchExistingTranslationsWithSpy({
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
        expect(axiosSpy).not.toHaveBeenCalled();
        axiosSpy.mockRestore();
    });
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

    afterAll(() => {
        autoTranslate?.dispose();
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
        const { fixtureData, results, axiosSpy } = await fetchExistingTranslationsWithSpy({
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
        expect(axiosSpy).not.toHaveBeenCalled();
        axiosSpy.mockRestore();
    });
});
