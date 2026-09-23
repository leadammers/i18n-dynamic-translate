import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@tests': path.resolve(__dirname, './tests'),
        },
    },
    test: {
        coverage: {
            provider: 'v8',
            // `lcov` is what Codecov reads; `text` prints the table locally and in
            // the CI log; `json-summary` is the machine-readable one.
            reporter: ['text', 'lcov', 'json-summary'],
            reportsDirectory: 'coverage',
            // Only the shipped library counts. `all` keeps a file that no test
            // imports in the report at 0% instead of silently omitting it.
            include: ['src/**/*.ts'],
            // `types/` is interfaces and enums: nothing there executes, so it would
            // report as uncovered lines that do not exist at runtime.
            exclude: ['src/types/**'],
            all: true,
            // A floor a little under the current numbers: high enough that deleting a
            // suite fails the build, loose enough that one refactored branch does not.
            // Raise them when a run comes in comfortably above; never lower them to make
            // a red build green.
            thresholds: {
                statements: 94,
                branches: 90,
                functions: 95,
                lines: 94,
            },
        },
    },
});
