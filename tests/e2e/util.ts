/**
 * E2E Test Utils
 */

import { vi, type MockInstance } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { http } from '@/utils/http';
import { AutoTranslate } from '@/index';

// ============================================================================
// File Helpers
// ============================================================================

import type { Resource } from 'i18next';

export function loadLocaleResources(localesPath: string, locales: string[], namespaces: string[]): Resource {
    const resources: Resource = {};

    for (const locale of locales) {
        resources[locale] = {};
        for (const ns of namespaces) {
            const filePath = path.join(localesPath, locale, `${ns}.json`);
            resources[locale][ns] = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : {};
        }
    }

    return resources;
}

export function readJsonFile(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function writeJsonFile(filePath: string, data: Record<string, unknown>, trailingNewline = false): void {
    const content = JSON.stringify(data, null, 2) + (trailingNewline ? '\n' : '');
    fs.writeFileSync(filePath, content, 'utf-8');
}

// ============================================================================
// Object Helpers
// ============================================================================

/**
 * Reads any node — object or leaf — out of a fixture that was written to disk.
 *
 * Deliberately not the library's `getNestedValue`: this is an assertion helper
 * over trusted test data, and it returns branches as well as strings. The
 * hardened walk in `@/utils/objectPath` is the one every runtime path uses.
 */
export function readFixturePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((curr, key) => {
        if (curr && typeof curr === 'object' && key in curr) {
            return (curr as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);
}

export function deleteNestedKey(obj: Record<string, unknown>, path: string): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const parent = keys.reduce<unknown>((curr, key) => {
        if (curr && typeof curr === 'object') {
            return (curr as Record<string, unknown>)[key];
        }
        return undefined;
    }, obj);

    if (parent && typeof parent === 'object' && lastKey in parent) {
        delete (parent as Record<string, unknown>)[lastKey];
    }
}

// ============================================================================
// Translation Test Helpers
// ============================================================================

export interface TranslateObjectParams {
    autoTranslate: AutoTranslate;
    sourceData: Record<string, string>;
    targetLocale: string;
    namespace?: string;
    parentKey: string;
    localeFilePath: string;
}

export interface TranslateObjectResult {
    translations: Record<string, string>;
    savedData: Record<string, unknown>;
    savedTranslations: Record<string, string>;
}

export async function translateObjectAndReadFile({
    autoTranslate,
    sourceData,
    targetLocale,
    namespace,
    parentKey,
    localeFilePath,
}: TranslateObjectParams): Promise<TranslateObjectResult> {
    const translations = await autoTranslate.translateObject(sourceData, targetLocale, {
        namespace,
        parentKey,
    });

    const savedData = readJsonFile(localeFilePath);
    const savedTranslations = readFixturePath(savedData, parentKey) as Record<string, string>;

    return { translations, savedData, savedTranslations };
}

export interface TranslationFixture {
    key: string;
    parentKey: string;
    expectedValue: string;
    context?: string;
    namespace?: string;
}

export interface ExistingTranslationsParams {
    autoTranslate: AutoTranslate;
    localeFilePath: string;
    translations: TranslationFixture[];
    targetLocale: string;
}

export interface ExistingTranslationsResult {
    fixtureData: Record<string, unknown>;
    results: string[];
    httpSpy: MockInstance;
}

export async function fetchExistingTranslationsWithSpy({
    autoTranslate,
    localeFilePath,
    translations,
    targetLocale,
}: ExistingTranslationsParams): Promise<ExistingTranslationsResult> {
    const fixtureData = readJsonFile(localeFilePath);
    const httpSpy = vi.spyOn(http, 'post');

    const results: string[] = [];
    for (const { key, parentKey, context, namespace } of translations) {
        const result = await autoTranslate.translateKey(key, targetLocale, { parentKey, namespace, context });
        results.push(result);
    }

    return { fixtureData, results, httpSpy };
}
