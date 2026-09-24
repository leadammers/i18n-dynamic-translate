import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    detectFileFormat,
    fileExists,
    readLocaleFile,
    writeLocaleFile,
    getLocaleFilePath,
    appendTranslationToFile,
} from '@/utils/fileHandler';
import { FileFormat } from '@/types';
import { FileSystemError } from '@/utils/errors';

const TEST_DIR = path.join(__dirname, '.test-temp');

describe('FileHandler', () => {
    beforeEach(async () => {
        // Create test directory
        await fs.mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
        // Cleanup test directory
        try {
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('detectFileFormat', () => {
        it('should detect JSON format', () => {
            expect(detectFileFormat('en.json')).toBe(FileFormat.JSON);
            expect(detectFileFormat('/path/to/en.json')).toBe(FileFormat.JSON);
            expect(detectFileFormat('translation.JSON')).toBe(FileFormat.JSON);
        });

        it('should detect YAML format', () => {
            expect(detectFileFormat('en.yaml')).toBe(FileFormat.YAML);
            expect(detectFileFormat('/path/to/en.yml')).toBe(FileFormat.YAML);
            expect(detectFileFormat('translation.YAML')).toBe(FileFormat.YAML);
            expect(detectFileFormat('translation.YML')).toBe(FileFormat.YAML);
        });

        it('should default to JSON for unknown extensions', () => {
            expect(detectFileFormat('en.txt')).toBe(FileFormat.JSON);
            expect(detectFileFormat('en')).toBe(FileFormat.JSON);
            expect(detectFileFormat('en.xml')).toBe(FileFormat.JSON);
        });
    });

    describe('fileExists', () => {
        it('should return true for existing files', async () => {
            const filePath = path.join(TEST_DIR, 'test.json');
            await fs.writeFile(filePath, '{}');

            expect(await fileExists(filePath)).toBe(true);
        });

        it('should return false for non-existing files', async () => {
            const filePath = path.join(TEST_DIR, 'nonexistent.json');
            expect(await fileExists(filePath)).toBe(false);
        });

        it('should return true for directories', async () => {
            expect(await fileExists(TEST_DIR)).toBe(true);
        });
    });

    describe('readLocaleFile', () => {
        it('should read JSON file', async () => {
            const filePath = path.join(TEST_DIR, 'en.json');
            await fs.writeFile(filePath, JSON.stringify({ hello: 'Hello', world: 'World' }));

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({ hello: 'Hello', world: 'World' });
        });

        it('should read YAML file', async () => {
            const filePath = path.join(TEST_DIR, 'en.yaml');
            await fs.writeFile(filePath, 'hello: Hello\nworld: World');

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({ hello: 'Hello', world: 'World' });
        });

        it('should return empty object for non-existent file', async () => {
            const filePath = path.join(TEST_DIR, 'nonexistent.json');

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({});
        });

        it('should handle nested JSON structures', async () => {
            const filePath = path.join(TEST_DIR, 'en.json');
            const content = {
                user: {
                    profile: {
                        name: 'Name',
                        email: 'Email',
                    },
                },
            };
            await fs.writeFile(filePath, JSON.stringify(content));

            const data = await readLocaleFile(filePath);

            expect(data).toEqual(content);
        });

        it('should handle empty JSON file', async () => {
            const filePath = path.join(TEST_DIR, 'empty.json');
            await fs.writeFile(filePath, '');

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({});
        });

        // js-yaml v4 returned `undefined` for a document with no content and v5 throws
        // instead. Both peer-supported majors have to yield `{}` here, or an empty
        // locale file would reach the consumer as a FileSystemError.
        it('should handle empty YAML file', async () => {
            const filePath = path.join(TEST_DIR, 'empty.yaml');
            await fs.writeFile(filePath, '');

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({});
        });

        it('should handle a YAML file holding only whitespace and comments', async () => {
            const filePath = path.join(TEST_DIR, 'comments.yml');
            await fs.writeFile(filePath, '# nothing here yet\n\n   \n');

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({});
        });

        // A `#` inside a value must not make the line read as a comment.
        it('should not mistake a hash inside a value for an empty document', async () => {
            const filePath = path.join(TEST_DIR, 'hash.yaml');
            await fs.writeFile(filePath, 'greeting: "a # b"\n');

            const data = await readLocaleFile(filePath);

            expect(data).toEqual({ greeting: 'a # b' });
        });

        it('should throw FileSystemError for invalid JSON', async () => {
            const filePath = path.join(TEST_DIR, 'invalid.json');
            await fs.writeFile(filePath, '{ invalid json }');

            await expect(readLocaleFile(filePath)).rejects.toThrow(FileSystemError);
        });
    });

    describe('writeLocaleFile', () => {
        it('should write JSON file', async () => {
            const filePath = path.join(TEST_DIR, 'output.json');
            const data = { hello: 'Hello', world: 'World' };

            await writeLocaleFile(filePath, data);

            const content = await fs.readFile(filePath, 'utf-8');
            expect(JSON.parse(content)).toEqual(data);
        });

        it('should write YAML file', async () => {
            const filePath = path.join(TEST_DIR, 'output.yaml');
            const data = { hello: 'Hello', world: 'World' };

            await writeLocaleFile(filePath, data);

            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toContain('hello: Hello');
            expect(content).toContain('world: World');
        });

        it('should format JSON with indentation', async () => {
            const filePath = path.join(TEST_DIR, 'formatted.json');
            const data = { hello: 'Hello' };

            await writeLocaleFile(filePath, data);

            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toContain('  "hello"'); // 2-space indentation
            expect(content.endsWith('\n')).toBe(true);
        });

        it('should default to JSON format', async () => {
            const filePath = path.join(TEST_DIR, 'data.txt');
            const data = { hello: 'Hello' };

            await writeLocaleFile(filePath, data);

            const content = await fs.readFile(filePath, 'utf-8');
            expect(JSON.parse(content)).toEqual(data);
        });
    });

    describe('getLocaleFilePath', () => {
        it('should generate path for i18n-node style (no namespace)', async () => {
            const result = await getLocaleFilePath('/locales', 'en');
            expect(result).toBe(path.join('/locales', 'en.json'));
        });

        it('should generate path for i18next style (with namespace)', async () => {
            const result = await getLocaleFilePath('/locales', 'en', 'translation');
            expect(result).toBe(path.join('/locales', 'en', 'translation.json'));
        });

        it('should use YAML extension when specified', async () => {
            const result = await getLocaleFilePath('/locales', 'en', 'translation', FileFormat.YAML);
            expect(result).toBe(path.join('/locales', 'en', 'translation.yaml'));
        });

        it('should handle various locale codes', async () => {
            expect(await getLocaleFilePath('/locales', 'en-US')).toBe(path.join('/locales', 'en-US.json'));
            expect(await getLocaleFilePath('/locales', 'zh-CN', 'common')).toBe(
                path.join('/locales', 'zh-CN', 'common.json')
            );
        });

        it('should reject a locale that escapes localesPath', async () => {
            await expect(getLocaleFilePath('/locales', '../../etc/passwd')).rejects.toThrow(FileSystemError);
            await expect(getLocaleFilePath('/locales', '../../etc/passwd')).rejects.toThrow(/Path traversal detected/);
        });

        it('should reject a namespace that escapes localesPath', async () => {
            await expect(getLocaleFilePath('/locales', 'en', '../../../etc/passwd')).rejects.toThrow(FileSystemError);
        });

        it('should reject a locale that resolves to localesPath itself', async () => {
            // `.` joins away to the base directory, and the extension is appended after
            // the guard runs — so letting it through wrote `/locales.json`, a sibling of
            // the locales directory rather than a file inside it. An empty locale, which
            // `translateKey` does not reject, lands in the same place.
            for (const locale of ['.', '']) {
                await expect(getLocaleFilePath('/locales', locale)).rejects.toThrow(FileSystemError);
                await expect(getLocaleFilePath('/locales', locale)).rejects.toThrow(/Path traversal detected/);
            }
        });
    });

    describe('appendTranslationToFile', () => {
        // `parentKey` is consumer input that becomes a path segment, and a locale
        // file is JSON, so `__proto__` survives the round trip as an own property.
        it('should nest under a parentKey named __proto__ without polluting', async () => {
            const filePath = path.join(TEST_DIR, 'proto.json');
            await writeLocaleFile(filePath, {});

            await appendTranslationToFile(filePath, 'carrier', 'Frachtfuhrer', '__proto__');

            const written = await readLocaleFile(filePath);
            const branch = Object.getOwnPropertyDescriptor(written, '__proto__')?.value as Record<string, string>;
            expect(branch?.carrier).toBe('Frachtfuhrer');
            expect(({} as Record<string, unknown>).carrier).toBeUndefined();
        });

        it('should append to new file', async () => {
            const filePath = path.join(TEST_DIR, 'new.json');

            await appendTranslationToFile(filePath, 'hello', 'Hello');

            const data = await readLocaleFile(filePath);
            expect(data).toEqual({ hello: 'Hello' });
        });

        it('should append to existing file', async () => {
            const filePath = path.join(TEST_DIR, 'existing.json');
            await fs.writeFile(filePath, JSON.stringify({ world: 'World' }));

            await appendTranslationToFile(filePath, 'hello', 'Hello');

            const data = await readLocaleFile(filePath);
            expect(data).toEqual({ hello: 'Hello', world: 'World' });
        });

        it('should handle nested keys', async () => {
            const filePath = path.join(TEST_DIR, 'nested.json');

            await appendTranslationToFile(filePath, 'user.profile.name', 'Name');

            const data = await readLocaleFile(filePath);
            expect(data).toEqual({ user: { profile: { name: 'Name' } } });
        });

        it('should update existing key', async () => {
            const filePath = path.join(TEST_DIR, 'update.json');
            await fs.writeFile(filePath, JSON.stringify({ hello: 'Hi' }));

            await appendTranslationToFile(filePath, 'hello', 'Hello');

            const data = await readLocaleFile(filePath);
            expect(data).toEqual({ hello: 'Hello' });
        });

        it('should work with YAML files', async () => {
            const filePath = path.join(TEST_DIR, 'test.yaml');

            // No format argument: the .yaml extension already selects the format,
            // and a fourth argument here would nest the value under a parent key.
            await appendTranslationToFile(filePath, 'greeting', 'Hello');

            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toContain('greeting: Hello');
        });
    });

    describe('edge cases', () => {
        it('should handle unicode content', async () => {
            const filePath = path.join(TEST_DIR, 'unicode.json');
            const data = {
                japanese: 'こんにちは',
                chinese: '你好',
                arabic: 'مرحبا',
                emoji: '👋🌍',
            };

            await writeLocaleFile(filePath, data);
            const read = await readLocaleFile(filePath);

            expect(read).toEqual(data);
        });

        it('should handle special characters in keys', async () => {
            const filePath = path.join(TEST_DIR, 'special.json');
            const data = {
                'key-with-dash': 'value1',
                key_with_underscore: 'value2',
                'key.with.dots': 'value3',
            };

            await writeLocaleFile(filePath, data);
            const read = await readLocaleFile(filePath);

            expect(read).toEqual(data);
        });
    });
});
