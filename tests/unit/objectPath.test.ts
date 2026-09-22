import { describe, it, expect } from 'vitest';
import { setNestedValue } from '@/utils/objectPath';

describe('ObjectPath', () => {
    describe('setNestedValue', () => {
        it('should set simple key', () => {
            const obj: Record<string, any> = {};
            setNestedValue(obj, 'hello', 'Hello');
            expect(obj).toEqual({ hello: 'Hello' });
        });

        it('should set nested key', () => {
            const obj: Record<string, any> = {};
            setNestedValue(obj, 'user.name', 'John');
            expect(obj).toEqual({ user: { name: 'John' } });
        });

        it('should set deeply nested key', () => {
            const obj: Record<string, any> = {};
            setNestedValue(obj, 'user.profile.settings.theme', 'dark');
            expect(obj).toEqual({
                user: {
                    profile: {
                        settings: {
                            theme: 'dark',
                        },
                    },
                },
            });
        });

        it('should preserve existing sibling keys', () => {
            const obj: Record<string, any> = { user: { name: 'John' } };
            setNestedValue(obj, 'user.email', 'john@example.com');
            expect(obj).toEqual({
                user: {
                    name: 'John',
                    email: 'john@example.com',
                },
            });
        });

        it('should overwrite existing values', () => {
            const obj: Record<string, any> = { user: { name: 'John' } };
            setNestedValue(obj, 'user.name', 'Jane');
            expect(obj).toEqual({ user: { name: 'Jane' } });
        });

        it('should overwrite non-object intermediate values', () => {
            const obj: Record<string, any> = { user: 'string' };
            setNestedValue(obj, 'user.name', 'John');
            expect(obj).toEqual({ user: { name: 'John' } });
        });

        // `typeof null === 'object'`, so a null left in a hand-edited locale file
        // used to pass the intermediate guard and then throw on the property write.
        it('should overwrite a null intermediate value', () => {
            const obj: Record<string, any> = { user: null };
            setNestedValue(obj, 'user.name', 'John');
            expect(obj).toEqual({ user: { name: 'John' } });
        });
    });
});
