import { describe, it, expect } from 'vitest';
import { validateProfileName, isValidProfileName, sanitizeProfileName } from './validator.js';

describe('validateProfileName', () => {
  it('accepts valid names', () => {
    expect(() => validateProfileName('personal')).not.toThrow();
    expect(() => validateProfileName('work')).not.toThrow();
    expect(() => validateProfileName('client-acme')).not.toThrow();
    expect(() => validateProfileName('a')).not.toThrow();
    expect(() => validateProfileName('test123')).not.toThrow();
    expect(() => validateProfileName('my-long-profile-name')).not.toThrow();
  });

  it('rejects empty names', () => {
    expect(() => validateProfileName('')).toThrow('cannot be empty');
  });

  it('rejects reserved names', () => {
    expect(() => validateProfileName('default')).toThrow('reserved');
    expect(() => validateProfileName('all')).toThrow('reserved');
    expect(() => validateProfileName('none')).toThrow('reserved');
    expect(() => validateProfileName('config')).toThrow('reserved');
    expect(() => validateProfileName('profiles')).toThrow('reserved');
  });

  it('rejects names starting with digit', () => {
    expect(() => validateProfileName('1profile')).toThrow('Invalid profile name');
  });

  it('rejects names with uppercase', () => {
    expect(() => validateProfileName('MyProfile')).toThrow('Invalid profile name');
  });

  it('rejects names with spaces', () => {
    expect(() => validateProfileName('my profile')).toThrow('Invalid profile name');
  });

  it('rejects names with dots', () => {
    expect(() => validateProfileName('my.profile')).toThrow('Invalid profile name');
  });

  it('suggests a sanitized alternative for dotted names (Issue 10)', () => {
    try {
      validateProfileName('avital.bennatan');
      throw new Error('expected to throw');
    } catch (err) {
      const e = err as { suggestion?: string; code?: string };
      expect(e.code).toBe('INVALID_PROFILE_NAME');
      expect(e.suggestion ?? '').toMatch(/Try 'avital-bennatan'/);
    }
  });

  it('suggests a sanitized alternative for uppercase names', () => {
    try {
      validateProfileName('MyProfile');
      throw new Error('expected to throw');
    } catch (err) {
      const e = err as { suggestion?: string; code?: string };
      expect(e.code).toBe('INVALID_PROFILE_NAME');
      expect(e.suggestion ?? '').toMatch(/Try 'myprofile'/);
    }
  });

  it('rejects path traversal', () => {
    expect(() => validateProfileName('../evil')).toThrow();
  });

  it('rejects names over 63 characters', () => {
    const longName = 'a' + 'b'.repeat(63);
    expect(() => validateProfileName(longName)).toThrow('Invalid profile name');
  });
});

describe('isValidProfileName', () => {
  it('returns true for valid names', () => {
    expect(isValidProfileName('work')).toBe(true);
    expect(isValidProfileName('personal')).toBe(true);
  });

  it('returns false for invalid names', () => {
    expect(isValidProfileName('')).toBe(false);
    expect(isValidProfileName('default')).toBe(false);
    expect(isValidProfileName('UPPER')).toBe(false);
  });
});

describe('sanitizeProfileName', () => {
  it('replaces dots with hyphens', () => {
    expect(sanitizeProfileName('avital.bennatan')).toBe('avital-bennatan');
  });

  it('lowercases', () => {
    expect(sanitizeProfileName('MyProfile')).toBe('myprofile');
  });

  it('replaces underscores and whitespace with hyphens', () => {
    expect(sanitizeProfileName('my_profile')).toBe('my-profile');
    expect(sanitizeProfileName('my profile')).toBe('my-profile');
  });

  it('strips disallowed characters', () => {
    expect(sanitizeProfileName('foo@bar!baz')).toBe('foobarbaz');
  });

  it('strips leading non-letters', () => {
    expect(sanitizeProfileName('123abc')).toBe('abc');
    expect(sanitizeProfileName('-abc')).toBe('abc');
  });

  it('caps at 63 characters', () => {
    const long = 'a' + 'b'.repeat(100);
    const out = sanitizeProfileName(long)!;
    expect(out.length).toBeLessThanOrEqual(63);
  });

  it('returns null when nothing salvageable', () => {
    expect(sanitizeProfileName('!!!')).toBeNull();
    expect(sanitizeProfileName('')).toBeNull();
    expect(sanitizeProfileName('123')).toBeNull();
  });
});
