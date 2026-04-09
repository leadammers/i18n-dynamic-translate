import { describe, it, expect } from 'vitest';
import {
    convertKeyToText,
    convertKeyToSentence,
    isNestedKey,
    getLastSegment,
    getParentPath,
} from '@/utils/keyConverter';

describe('keyConverter', () => {
    describe('convertKeyToText', () => {
        it('should convert camelCase to readable text', () => {
            expect(convertKeyToText('userName')).toBe('User Name');
            expect(convertKeyToText('firstName')).toBe('First Name');
            expect(convertKeyToText('emailAddress')).toBe('Email Address');
        });

        it('should convert snake_case to readable text', () => {
            expect(convertKeyToText('user_name')).toBe('User Name');
            expect(convertKeyToText('first_name')).toBe('First Name');
            expect(convertKeyToText('email_address')).toBe('Email Address');
        });

        it('should convert kebab-case to readable text', () => {
            expect(convertKeyToText('user-name')).toBe('User Name');
            expect(convertKeyToText('first-name')).toBe('First Name');
        });

        it('should handle PascalCase', () => {
            expect(convertKeyToText('UserName')).toBe('User Name');
            expect(convertKeyToText('FirstName')).toBe('First Name');
        });

        it('should handle nested keys (dot notation)', () => {
            expect(convertKeyToText('user.profile.userName')).toBe('User Name');
            expect(convertKeyToText('settings.account.emailAddress')).toBe('Email Address');
        });

        it('should preserve acronyms in consecutive capitals', () => {
            expect(convertKeyToText('XMLParser')).toBe('XML Parser');
            expect(convertKeyToText('HTMLElement')).toBe('HTML Element');
            expect(convertKeyToText('apiURL')).toBe('Api URL');
        });

        it('should handle empty or invalid input', () => {
            expect(convertKeyToText('')).toBe('');
            expect(convertKeyToText(null as any)).toBe('');
            expect(convertKeyToText(undefined as any)).toBe('');
        });
    });

    describe('convertKeyToSentence', () => {
        it('should convert to sentence case', () => {
            expect(convertKeyToSentence('userName')).toBe('User name');
            expect(convertKeyToSentence('firstName')).toBe('First name');
        });
    });

    describe('isNestedKey', () => {
        it('should detect nested keys', () => {
            expect(isNestedKey('user.name')).toBe(true);
            expect(isNestedKey('user.profile.name')).toBe(true);
            expect(isNestedKey('userName')).toBe(false);
            expect(isNestedKey('user_name')).toBe(false);
        });
    });

    describe('getLastSegment', () => {
        it('should get last segment of nested key', () => {
            expect(getLastSegment('user.profile.name')).toBe('name');
            expect(getLastSegment('user.name')).toBe('name');
            expect(getLastSegment('name')).toBe('name');
        });
    });

    describe('getParentPath', () => {
        it('should get parent path of nested key', () => {
            expect(getParentPath('user.profile.name')).toBe('user.profile');
            expect(getParentPath('user.name')).toBe('user');
            expect(getParentPath('name')).toBe('');
        });
    });
});
