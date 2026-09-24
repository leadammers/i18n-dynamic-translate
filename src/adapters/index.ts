/**
 * Backend Adapter Factory
 * Creates appropriate backend adapter based on configuration
 */

import { BackendAdapter, Backend } from '@/types';
import { I18nextAdapter } from '@/adapters/i18nextAdapter';
import { I18nNodeAdapter } from '@/adapters/i18nNodeAdapter';
import { ConfigurationError } from '@/utils/errors';

/**
 * Create a backend adapter instance
 */
export function createBackendAdapter(backend: Backend): BackendAdapter {
    switch (backend) {
        case Backend.I18NEXT:
            return new I18nextAdapter();

        case Backend.I18N_NODE:
            return new I18nNodeAdapter();

        default:
            throw new ConfigurationError(`Unknown backend: ${backend}`);
    }
}
