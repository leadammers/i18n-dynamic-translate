import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileStorageAdapter } from '@/storage/FileStorageAdapter';
import { FileFormat } from '@/types';
import * as fileHandler from '@/utils/fileHandler';

vi.mock('@/utils/fileHandler', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/fileHandler')>();
    return {
        ...actual,
        getLocaleFilePath: vi.fn().mockResolvedValue('/locales/de/translation.json'),
        appendTranslationToFile: vi.fn().mockResolvedValue(undefined),
        readLocaleFile: vi.fn().mockResolvedValue({}),
        writeLocaleFile: vi.fn().mockResolvedValue(undefined),
    };
});

describe('FileStorageAdapter', () => {
    let adapter: FileStorageAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        adapter = new FileStorageAdapter({
            localesPath: '/locales',
        });
    });

    describe('save', () => {
        it('should resolve file path and append translation', async () => {
            await adapter.save('de', 'hello', 'Hallo', { namespace: 'translation' });

            expect(fileHandler.getLocaleFilePath).toHaveBeenCalledWith('/locales', 'de', 'translation', undefined);
            expect(fileHandler.appendTranslationToFile).toHaveBeenCalledWith(
                '/locales/de/translation.json',
                'hello',
                'Hallo',
                undefined
            );
        });

        it('should pass parentKey to appendTranslationToFile', async () => {
            await adapter.save('de', 'category', 'Kategorie', {
                namespace: 'products',
                parentKey: 'product.meta',
            });

            expect(fileHandler.appendTranslationToFile).toHaveBeenCalledWith(
                '/locales/de/translation.json',
                'category',
                'Kategorie',
                'product.meta'
            );
        });

        it('should pass fileFormat to getLocaleFilePath', async () => {
            const yamlAdapter = new FileStorageAdapter({
                localesPath: '/locales',
                fileFormat: FileFormat.YAML,
            });

            await yamlAdapter.save('de', 'hello', 'Hallo');

            expect(fileHandler.getLocaleFilePath).toHaveBeenCalledWith('/locales', 'de', undefined, FileFormat.YAML);
        });

        it('should serialize concurrent writes to the same file', async () => {
            const callOrder: string[] = [];

            vi.mocked(fileHandler.appendTranslationToFile).mockImplementation(async (_path: string, key: string) => {
                callOrder.push(`start:${key}`);
                await new Promise((resolve: (value: unknown) => void) => setTimeout(resolve, 10));
                callOrder.push(`end:${key}`);
            });

            await Promise.all([adapter.save('de', 'a', 'A'), adapter.save('de', 'b', 'B')]);

            // With file lock, writes should be serialized (not interleaved)
            expect(callOrder).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
        });
    });

    describe('saveBatch', () => {
        it('should group entries by file and do one write per file', async () => {
            vi.mocked(fileHandler.getLocaleFilePath)
                .mockResolvedValueOnce('/locales/de/products.json')
                .mockResolvedValueOnce('/locales/de/products.json')
                .mockResolvedValueOnce('/locales/es/products.json');

            vi.mocked(fileHandler.readLocaleFile).mockResolvedValue({});

            await adapter.saveBatch([
                { locale: 'de', key: 'a', value: 'A', namespace: 'products', parentKey: 'meta' },
                { locale: 'de', key: 'b', value: 'B', namespace: 'products', parentKey: 'meta' },
                { locale: 'es', key: 'a', value: 'A_es', namespace: 'products', parentKey: 'meta' },
            ]);

            // Should write 2 files (de + es), not 3 individual writes
            expect(fileHandler.writeLocaleFile).toHaveBeenCalledTimes(2);
        });

        it('should merge all keys into the file data before writing', async () => {
            vi.mocked(fileHandler.getLocaleFilePath).mockResolvedValue('/locales/de/t.json');
            vi.mocked(fileHandler.readLocaleFile).mockResolvedValue({ existing: 'value' });

            await adapter.saveBatch([
                { locale: 'de', key: 'a', value: 'A' },
                { locale: 'de', key: 'b', value: 'B' },
            ]);

            expect(fileHandler.writeLocaleFile).toHaveBeenCalledTimes(1);
            const writtenData = vi.mocked(fileHandler.writeLocaleFile).mock.calls[0][1];
            expect(writtenData).toEqual({ existing: 'value', a: 'A', b: 'B' });
        });
    });
});
