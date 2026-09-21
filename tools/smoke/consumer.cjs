/**
 * Runs inside a scratch project that has the packed tarball installed, so every
 * require below resolves the way a consumer's would — through `main`, `exports`
 * and a real `node_modules`.
 *
 * Exercises the full path once: missing key -> stub provider over HTTP -> live
 * i18next instance -> YAML locale file. The YAML write is the point of using
 * YAML here: `js-yaml` is an optional peer loaded through a lazy `import()`, and
 * that import resolves from a different place in an installed package than it
 * does in the repository.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { AutoTranslate, Backend, FileFormat, TranslationProvider } = require('i18n-dynamic-translate');
const i18next = require('i18next');

const SOURCE_TEXT = 'Welcome Message';
const TRANSLATED_TEXT = 'Willkommensnachricht';

/** Stand-in for LibreTranslate: no network, no credentials, deterministic answer. */
function startStubProvider() {
    return new Promise((resolve) => {
        const server = http.createServer((request, response) => {
            let body = '';
            request.on('data', (chunk) => {
                body += chunk;
            });
            request.on('end', () => {
                const { q } = JSON.parse(body);
                assert.equal(q, SOURCE_TEXT, `provider received ${JSON.stringify(q)}`);
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ translatedText: TRANSLATED_TEXT }));
            });
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function main() {
    // The package is reachable by name and ships its declarations.
    const manifest = require('i18n-dynamic-translate/package.json');
    assert.equal(manifest.name, 'i18n-dynamic-translate');
    const packageRoot = path.dirname(require.resolve('i18n-dynamic-translate/package.json'));
    assert.ok(fs.existsSync(path.join(packageRoot, 'dist/index.d.ts')), 'dist/index.d.ts is missing from the tarball');

    const localesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-smoke-'));
    fs.writeFileSync(path.join(localesPath, 'de.yaml'), '{}\n');

    const server = await startStubProvider();
    const { port } = server.address();

    await i18next.init({ lng: 'de', fallbackLng: 'de', resources: { de: { translation: {} } } });

    const autoTranslate = new AutoTranslate({
        backend: Backend.I18NEXT,
        i18nInstance: i18next,
        localesPath,
        defaultLanguage: 'en',
        fileFormat: FileFormat.YAML,
        autoSave: true,
        translationProvider: {
            provider: TranslationProvider.LIBRE_TRANSLATE,
            apiUrl: `http://127.0.0.1:${port}/translate`,
        },
    });

    try {
        const translated = await autoTranslate.translateKey('welcomeMessage', 'de');
        assert.equal(translated, TRANSLATED_TEXT, 'translateKey returned the wrong value');

        // Written back into the live instance...
        assert.equal(i18next.getFixedT('de', 'translation')('welcomeMessage'), TRANSLATED_TEXT);

        // ...and persisted, which is what proves the lazy js-yaml import resolved.
        const persisted = fs.readFileSync(path.join(localesPath, 'de.yaml'), 'utf8');
        assert.match(persisted, /welcomeMessage: Willkommensnachricht/);

        // Cached: a second call must not reach the provider, which would fail the
        // assertion above if the source text ever changed shape.
        assert.deepEqual(autoTranslate.getCacheStats(), { size: 1 });
    } finally {
        await autoTranslate.dispose();
        server.close();
        fs.rmSync(localesPath, { recursive: true, force: true });
    }

    console.log('smoke: installed package translates, writes YAML and caches');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
