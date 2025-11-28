/**
 * Backend Adapter Factory
 * Creates appropriate backend adapter based on configuration
 */

import { BackendAdapter, Backend } from '@/types';
import { I18nextAdapter } from '@/adapters/i18nextAdapter';
import { NodeI18nAdapter } from '@/adapters/nodeI18nAdapter';
import { ConfigurationError } from '@/utils/errors';

/**
 * Create a backend adapter instance
 */
export function createBackendAdapter(backend: Backend): BackendAdapter {
    switch (backend) {
        case Backend.I18NEXT:
            return new I18nextAdapter();

        case Backend.NODE_I18N:
            return new NodeI18nAdapter();

        default:
            throw new ConfigurationError(`Unknown backend: ${backend}`);
    }
}
