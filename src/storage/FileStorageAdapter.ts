/**
 * File-based storage adapter for persisting translations to locale files.
 * Default StorageAdapter implementation used when no custom adapter is provided.
 */

import { FileFormat, StorageAdapter, StorageSaveEntry } from '@/types';
import { appendTranslationToFile, getLocaleFilePath, readLocaleFile, writeLocaleFile } from '@/utils/fileHandler';
import { setNestedValue } from '@/utils/objectPath';
import { FileLock } from '@/utils/fileLock';

export interface FileStorageAdapterConfig {
    localesPath: string;
    fileFormat?: FileFormat;
}

export class FileStorageAdapter implements StorageAdapter {
    private fileLock = new FileLock();
    private localesPath: string;
    private fileFormat?: FileFormat;

    constructor(config: FileStorageAdapterConfig) {
        this.localesPath = config.localesPath;
        this.fileFormat = config.fileFormat;
    }

    async save(
        locale: string,
        key: string,
        value: string,
        options?: { namespace?: string; parentKey?: string }
    ): Promise<void> {
        const filePath = await getLocaleFilePath(this.localesPath, locale, options?.namespace, this.fileFormat);

        await this.fileLock.withLock(filePath, async () => {
            await appendTranslationToFile(filePath, key, value, options?.parentKey);
        });
    }

    async saveBatch(entries: StorageSaveEntry[]): Promise<void> {
        // Resolve file paths for all entries
        const entriesWithPaths = await Promise.all(
            entries.map(async (entry) => ({
                ...entry,
                filePath: await getLocaleFilePath(this.localesPath, entry.locale, entry.namespace, this.fileFormat),
            }))
        );

        // Group by file path
        const byFile = new Map<string, typeof entriesWithPaths>();
        for (const entry of entriesWithPaths) {
            if (!byFile.has(entry.filePath)) {
                byFile.set(entry.filePath, []);
            }
            byFile.get(entry.filePath)!.push(entry);
        }

        // One read-merge-write per file
        const writes = Array.from(byFile.entries()).map(([filePath, fileEntries]) =>
            this.fileLock.withLock(filePath, async () => {
                const data = await readLocaleFile(filePath);

                for (const entry of fileEntries) {
                    const fullKey = entry.parentKey ? `${entry.parentKey}.${entry.key}` : entry.key;
                    setNestedValue(data, fullKey, entry.value);
                }

                await writeLocaleFile(filePath, data);
            })
        );

        await Promise.all(writes);
    }
}
