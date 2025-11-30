/**
 * File Handler Utility
 * Async operations for reading and writing locale files (JSON/YAML)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { FileFormat, LocaleData, FileOperationResult } from '@/types';
import { FileSystemError } from '@/utils/errors';

/**
 * Detect file format from file path
 */
export function detectFileFormat(filePath: string): FileFormat {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
        return FileFormat.YAML;
    }
    return FileFormat.JSON;
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read locale file (JSON or YAML)
 */
export async function readLocaleFile(filePath: string, format?: FileFormat): Promise<LocaleData> {
    try {
        const exists = await fileExists(filePath);
        if (!exists) {
            return {};
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const fileFormat = format || detectFileFormat(filePath);

        if (fileFormat === FileFormat.YAML) {
            const data = yaml.load(content);
            return (data as LocaleData) || {};
        } else {
            return JSON.parse(content || '{}');
        }
    } catch (error) {
        throw new FileSystemError(`Failed to read locale file: ${filePath}`, filePath, error as Error);
    }
}

/**
 * Ensure parent directory exists, creating it recursively if needed
 */
async function ensureDirectoryExists(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}

/**
 * Write locale file (JSON or YAML)
 */
export async function writeLocaleFile(
    filePath: string,
    data: LocaleData,
    format?: FileFormat
): Promise<FileOperationResult> {
    try {
        const fileFormat = format || detectFileFormat(filePath);
        let content: string;

        if (fileFormat === FileFormat.YAML) {
            content = yaml.dump(data, { indent: 2, lineWidth: -1 });
        } else {
            content = JSON.stringify(data, null, 2) + '\n';
        }

        // Ensure parent directory exists before writing
        await ensureDirectoryExists(filePath);

        await fs.writeFile(filePath, content, 'utf-8');

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: new FileSystemError(`Failed to write locale file: ${filePath}`, filePath, error as Error),
        };
    }
}

/**
 * Set a nested value in an object using dot notation
 * @param obj - The object to modify
 * @param path - Dot-separated path (e.g., 'user.profile.name')
 * @param value - Value to set
 */
export function setNestedValue(obj: LocaleData, path: string, value: string | LocaleData): void {
    const keys = path.split('.');
    let current: LocaleData = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current) || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key] as LocaleData;
    }

    current[keys[keys.length - 1]] = value;
}

/**
 * Get a nested value from an object using dot notation
 * @param obj - The object to read from
 * @param path - Dot-separated path
 * @returns The value or null if not found
 */
export function getNestedValue(obj: LocaleData, path: string): string | LocaleData | null {
    const keys = path.split('.');
    let current: string | LocaleData = obj;

    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }

    return current;
}

/**
 * Get locale file path
 * @param localesPath - Base path to locales directory
 * @param locale - Locale code (e.g., 'en', 'fr')
 * @param namespace - Optional namespace for i18next
 * @param format - File format
 */
export function getLocaleFilePath(
    localesPath: string,
    locale: string,
    namespace?: string,
    format: FileFormat = FileFormat.JSON
): string {
    const ext = format === FileFormat.YAML ? 'yaml' : 'json';

    if (namespace) {
        // i18next style: locales/en/translation.json
        return path.join(localesPath, locale, `${namespace}.${ext}`);
    } else {
        // node-i18n style: locales/en.json
        return path.join(localesPath, `${locale}.${ext}`);
    }
}

/**
 * Append translation to locale file
 * @param filePath - Path to the locale file
 * @param key - Translation key
 * @param value - Translation value
 * @param format - File format (JSON or YAML)
 * @param parentKey - Optional parent key to nest translations under
 */
export async function appendTranslationToFile(
    filePath: string,
    key: string,
    value: string,
    format?: FileFormat,
    parentKey?: string
): Promise<FileOperationResult> {
    try {
        const data = await readLocaleFile(filePath, format);
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        setNestedValue(data, fullKey, value);
        return await writeLocaleFile(filePath, data, format);
    } catch (error) {
        return {
            success: false,
            error: error as Error,
        };
    }
}
