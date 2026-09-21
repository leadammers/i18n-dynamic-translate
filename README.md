# DynamicTranslate

[![npm version](https://img.shields.io/npm/v/i18n-dynamic-translate.svg)](https://www.npmjs.com/package/i18n-dynamic-translate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

**DynamicTranslate** automatically translates missing i18n keys in your application without manual work. Perfect for
translating dynamic content like API metadata or dynamic product attributes where the keys are not known beforehand
but still need to be localized.
It integrates seamlessly with i18next and node-i18n, uses DeepL or LibreTranslate for translations, and saves results
directly to your locale files.

> **Note:** This library has currently only been tested with DeepL. LibreTranslate support is implemented but not yet
> verified in production.

## When to use this

DynamicTranslate fills keys **at runtime**, inside the process serving the request. That is a
different job from the build-time CLI translators that walk a locale file and fill in what is
already listed in it — if your keys are known when you build, use one of those instead.

Reach for this when the set of keys cannot be known ahead of time: API metadata, product
attributes, category trees, anything data-driven.

### Alternatives

- **[locize](https://locize.com)** — the managed service from the i18next authors. It covers the
  same runtime missing-key flow and adds a translation-management UI, human review and a CDN.
  Choose it if you want a product. DynamicTranslate is the self-hosted take on the same idea: your
  own DeepL or LibreTranslate key, your own locale files in your own repository, no subscription
  and no third party holding your content.
- **Build-time translation CLIs** — a better fit whenever your keys are static.

### Honest limits

- **Translation is asynchronous.** The request that first encounters a missing key gets the
  fallback. The translation is written to the locale file and served from the next request on.
- **Every genuinely new key costs a provider API call.** Cached and persisted keys do not.
- **Machine translation of short UI fragments is often mediocre** without surrounding context.
  Use the `context` option and review what lands in your locale files.
- **Server-side only** — see [Prerequisites](#prerequisites).

## Features

- 🚀 **Automatic translation** of missing i18n keys
- 🔌 **Multiple backends** - Works with i18next and node-i18n
- 🌐 **Multiple providers** - DeepL and LibreTranslate support
- 🧠 **Context-aware translations** - Disambiguate meanings (e.g., "bank" → "Bank" (financial) vs "Ufer" (river) based on
  context)
- 💾 **Auto-save** - Writes translations directly to your locale files
- ⚡ **Caching** - In-memory cache prevents redundant API calls
- 🎯 **Type-safe** - Full TypeScript support with comprehensive error types
- 📦 **Batch translation** - Translate entire objects with `translateObject()`
- ⚙️ **Configurable** - Control concurrency, file formats (JSON/YAML), and namespaces
- 🔑 **Nested keys** - Support for deep key structures with `parentKey` option

## Prerequisites

- Node.js 22.12+, tested on 22 and 24 (current LTS) — **server-side only.** The library holds your provider API key and writes locale
  files, so it needs a trusted process and a filesystem. It is not usable in a browser, and it is
  not meant to be: shipping a DeepL key to a client would expose it. Edge runtimes without `node:fs`
  are unsupported for the same reason.
- An i18next or node-i18n instance already configured
- DeepL API key (free tier available at [deepl.com](https://www.deepl.com/pro-api)) or a self-hosted LibreTranslate
  instance

## Installation

```bash
npm install i18n-dynamic-translate
```

## Usage

### Configuration

```typescript
import {AutoTranslate, Backend, TranslationProvider} from 'i18n-dynamic-translate';

const autoTranslate = new AutoTranslate({
    backend: Backend.I18NEXT,
    i18nInstance: i18next,
    localesPath: './locales',
    defaultLanguage: 'en',
    translationProvider: {
        provider: TranslationProvider.DEEPL,
        apiKey: process.env.DEEPL_API_KEY,
    },
});
```

<details><summary>All configuration options</summary>

```typescript
import {AutoTranslate, Backend, TranslationProvider, FileFormat, DeepLModelType} from 'i18n-dynamic-translate';

const autoTranslate = new AutoTranslate({
    // ===== Required =====

    // Backend type - which i18n library you're using
    backend: Backend.I18NEXT,           // or Backend.NODE_I18N

    // Your initialized i18n instance
    i18nInstance: i18next,

    // Path to your locale files directory
    localesPath: './locales',

    // Source/default language code
    defaultLanguage: 'en',

    // Translation provider configuration
    translationProvider: {
        // Which translation service to use
        provider: TranslationProvider.DEEPL,    // or TranslationProvider.LIBRE_TRANSLATE

        // API key for the translation service
        apiKey: process.env.DEEPL_API_KEY,

        // Custom API URL (required for LibreTranslate, optional for DeepL)
        apiUrl: 'https://your-libretranslate-instance.com/translate',

        // DeepL-specific options
        deeplOptions: {
            // Controls formal/informal tone
            formality: 'prefer_more',           // 'default' | 'more' | 'less' | 'prefer_more' | 'prefer_less'

            // Application context for better translations
            context: 'e-commerce',

            // How to split sentences
            splitSentences: '1',                // '0' | '1' | 'nonewlines'

            // Specifies which DeepL model should be used for translation, default is latency
            modelType: DeepLModelType.QUALITY,  // 'QUALITY' | 'LATENCY'
        }
    },

    // ===== Optional =====

    // Save translations to files automatically (default: true)
    autoSave: true,

    // Enable in-memory caching (default: true)
    enableCache: true,

    // Maximum parallel translation requests (default: 5)
    maxConcurrency: 5,

    // File format for locale files (default: auto-detected from existing files)
    fileFormat: FileFormat.JSON,        // or FileFormat.YAML

    // Default namespace for i18next (default: 'translation')
    defaultNamespace: 'translation',

    // Use dot notation for nested keys in node-i18n (default: false)
    objectNotation: false,

    // Cache time-to-live in milliseconds (default: 86400000 = 24 hours)
    cacheTTL: 24 * 60 * 60 * 1000,

    // Maximum number of cached entries (default: 1000)
    maxCacheSize: 1000,

    // Custom cache (default: built-in in-memory cache)
    // Implement the TranslationCache interface for Redis/Memcached/etc.
    // Supplying one enables caching regardless of enableCache. See "Custom Cache" below.
    // cache: myRedisCache,

    // Operating mode (default: 'development')
    // 'development' — auto-translate all missing keys
    // 'production' — only auto-translate within allowedNamespaces
    mode: 'production',

    // Namespaces allowed for auto-translation in production mode
    allowedNamespaces: ['products.metaData', 'api.labels'],

    // Custom key-to-text conversion function (overrides built-in converter).
    // Receives the last key segment, never the full dotted path.
    keyToText: (key) => key.replace(/_/g, ' '),

    // Error callback for the automatic missing-key handler (default: console.error)
    onError: (error, key, locale) => {
        myLogger.warn(`Translation failed for ${key} (${locale}):`, error);
    },

    // Custom storage adapter (default: FileStorageAdapter)
    // Implement the StorageAdapter interface for database/Redis/etc.
    // storageAdapter: new MyDatabaseAdapter(),
});
```

You can find the DeepL API
spec [here](https://developers.deepl.com/api-reference/translate#request-body-descriptions) to find out which options to
set for your use-case

</details>

### Automatic Translation of Missing Keys

Once configured, DynamicTranslate automatically intercepts missing translation keys at runtime. When your app requests a
translation that doesn't exist, it's translated and saved automatically:

```typescript
// Setup (once at app startup)
const autoTranslate = new AutoTranslate({
    backend: Backend.I18NEXT,
    i18nInstance: i18next,
    localesPath: './locales',
    defaultLanguage: 'en',
    translationProvider: {
        provider: TranslationProvider.DEEPL,
        apiKey: process.env.DEEPL_API_KEY,
    },
});

// Later in your app - this key doesn't exist yet
t('welcomeMessage'); // i18next fires missing key handler

// DynamicTranslate automatically:
// 1. Detects the missing key
// 2. Translates "welcome message" to the current locale (if present in default language, otherwise uses the key itself)
// 3. Saves it to your locale file
// 4. Adds it to i18next's runtime store
```

This is useful for catching missing translations during development, as well as dynamic scenarios where keys may not be
pre-defined or automatically populating locale files over time when you already have source content in your default
language.

> **Configuration notes**
> - **i18next**: Set `saveMissing: true` to trigger the missing key handler, but i18next won't write files itself
> - **node-i18n**: Set `updateFiles: false` to prevent node-i18n from writing files - DynamicTranslate handles all file
    writes via `autoSave: true`

### Translating API Metadata

Translate object keys for use as labels in the UI:

```typescript
// product = {
//     meta: {
//         carrier: 'DHL Express',
//         estimatedDelivery: '2-3 business days',
//     }
// };
const product = await fetchProduct();

// Translate all keys in product.meta
// context can be provided as optional parameter and will override global config for this call
await autoTranslate.translateObject(product.meta, 'de', {parentKey: 'product.meta', context: 'e-commerce'});
```

To generate translations in `locales/de/translation.json` (or `locales/de.json` for node-i18n):

```json
{
  "product": {
    "meta": {
      "carrier": "Spediteur",
      "estimatedDelivery": "Geschätzte Lieferung"
    }
  }
}
```

And use them in your UI, for example with React and react-i18next:

```tsx
function ProductMeta({meta}) {
    const {t} = useTranslation();

    return (
        <dl>
            {Object.entries(meta).map(([key, value]) => (
                <div key={key}>
                    <dt>{t(`product.meta.${key}`)}</dt>
                    {/* Translated label */}
                    <dd>{value}</dd>
                    {/* Original value */}
                </div>
            ))}
        </dl>
    );
}

// Renders: "Spediteur: DHL Express"
```

### Production Mode

In production, you typically only want auto-translation for specific namespaces (e.g., dynamic API metadata), not all missing keys. Use `mode: 'production'` with `allowedNamespaces`:

```typescript
const autoTranslate = new AutoTranslate({
    // ...
    mode: 'production',
    allowedNamespaces: ['products.metaData'],
});
```

In production mode:
- The **automatic missing-key handler** only processes keys within `allowedNamespaces` — all others are silently skipped
- **Explicit calls** (`translateKey()`, `translateObject()`) are never restricted and work for any namespace

### Custom Storage

By default, translations are saved to locale files. You can provide a custom `StorageAdapter` to persist to a database, Redis, or any other backend:

```typescript
import { AutoTranslate, StorageAdapter } from 'i18n-dynamic-translate';

const myAdapter: StorageAdapter = {
    async save(locale, key, value, options) {
        await db.upsert('translations', { locale, key, value, ...options });
    },
    // Optional: optimize bulk writes
    async saveBatch(entries) {
        await db.bulkUpsert('translations', entries);
    },
};

const autoTranslate = new AutoTranslate({
    // ...
    storageAdapter: myAdapter,
});
```

### Custom Cache

The built-in cache is in-memory and per-process. Supply a `TranslationCache` to share
translations across instances or survive a restart — supplying one enables caching regardless of
`enableCache`:

```typescript
import { AutoTranslate, TranslationCache, TranslationIdentity } from 'i18n-dynamic-translate';

// Every field of the identity changes the translation, so all of them belong in the
// storage key. Encode rather than join: a namespace or context may contain your separator.
const storageKey = (identity: TranslationIdentity): string =>
    JSON.stringify([identity.locale, identity.namespace ?? '', identity.key, identity.context ?? null]);

const redisCache: TranslationCache = {
    get: (identity) => redis.get(storageKey(identity)),
    set: (identity, value) => redis.set(storageKey(identity), value, 'EX', 86400),
    has: (identity) => redis.exists(storageKey(identity)),
    clear: () => redis.flushdb(),
    // Optional — without it, getCacheStats() reports null
    getStats: () => ({ size: redis.dbsize() }),
};

const autoTranslate = new AutoTranslate({
    // ...
    cache: redisCache,
});
```

`identity.key` is the full dot path the translation occupies (`meta.name`, with any `parentKey`
already folded in), so it matches what the backend and the locale file use. That makes
namespace-scoped invalidation straightforward.

## API

### `translateObject(obj, targetLocale, options?)`

Translates all keys in an object.

```typescript
await autoTranslate.translateObject(obj, 'de', {
    namespace: 'common',
    parentKey: 'myKey',
    context: 'e-commerce'
});
```

<details><summary><strong>Translation options explained</strong></summary>

Both `translateKey()` and `translateObject()` accept an optional `options` parameter with the following properties:

#### `namespace` (string, optional)

- **i18next only** - Specifies which namespace to use
- Affects the file path where translations are saved
- Example: `{ namespace: 'common' }` saves to `locales/de/common.json`

#### `parentKey` (string, optional)

- Nests the translation under a specific key path
- Useful for organizing related translations
- Example: `{ parentKey: 'product.meta' }` creates nested structure

#### `context` (string, optional)

- Provides additional context to improve translation accuracy
- Helps disambiguate words with multiple meanings
- Example: `{ context: 'e-commerce' }` helps translate "bank" correctly

</details>

### `translateKey(key, targetLocale, options?)`

Translates a single key.

```typescript
await autoTranslate.translateKey('myKey', 'de', {
    parentKey: 'ui',
    context: 'button label'
});
```

### `clearCache()`

Clears the in-memory translation cache.

```typescript
autoTranslate.clearCache();
```

### `getCacheStats()`

Returns the number of cached entries, or `null` when caching is off — or when a custom cache
does not implement the optional `getStats()`.

```typescript
const stats = autoTranslate.getCacheStats();
// { size: 42 }
```

### `getConfig()`

Returns a readonly copy of the current configuration.

```typescript
const config = autoTranslate.getConfig();
```

### `isDisposed()`

Check if the instance has been disposed.

```typescript
if (!autoTranslate.isDisposed()) {
    await autoTranslate.translateKey('hello', 'de');
}
```

### `dispose()`

Clean up resources when done. Waits for in-flight translations to complete, then stops cache cleanup timers and restores original i18n handlers.

```typescript
await autoTranslate.dispose();
```

## Error Handling

DynamicTranslate provides specific error types for handling various failure scenarios:

```typescript
import {
    TranslationError,
    BackendError,
    FileSystemError,
    ConfigurationError
} from 'i18n-dynamic-translate';

try {
    await autoTranslate.translateKey('key', 'de');
} catch (error) {
    if (error instanceof ConfigurationError) {
        console.error('Configuration error:', error.message);
    } else if (error instanceof TranslationError) {
        console.error(`Translation failed with ${error.provider}:`, error.message);
    } else if (error instanceof FileSystemError) {
        console.error(`File error at ${error.filePath}:`, error.message);
    } else if (error instanceof BackendError) {
        console.error(`Backend error:`, error.message);
    } else {
        console.error('An unexpected error occurred:', error);
    }
}
```

## Common Issues

- **API Key Errors**: Ensure your API key is set in your environment and has sufficient quota.
- **File Permissions**: Verify that your application has write access to the locale files.
- **Conflicting i18n settings**: Ensure `saveMissing` (i18next) or `updateFiles` (node-i18n) are set correctly.
- **Invalid locale codes**: Use standard locale codes (e.g., 'en', 'de', 'fr', 'es').
- **Rate Limits**: Be aware of rate limits imposed by translation providers, adjust `maxConcurrency` as needed.
- **Unsupported Languages**: Check if your translation provider supports the target language.

## Roadmap

- [x] **Batch translation support** - Translate multiple keys in a single API call if supported by translation provider
- [x] **File format auto-detection** - Automatically detect JSON/YAML based on existing files
- [x] **Storage abstraction** - Pluggable `StorageAdapter` interface for custom persistence backends
- [x] **Production mode** - Namespace allowlist for safe production deployment
- [x] **HTTP retry** - Automatic retry with exponential backoff for transient API failures
- [ ] **LibreTranslate verification** - Full testing and validation
- [ ] **Google Translate support** - Add Google Cloud Translation API integration
- [ ] **Azure Translator support** - Add Microsoft Azure Translation API integration

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branching, commit and review workflow, and
[AGENTS.md](AGENTS.md) for an architecture overview and the convention index.

## License

MIT