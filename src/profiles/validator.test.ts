import { describe, it, expect } from 'vitest';
import { validateProfileName, isValidProfileName } from './validator.js';

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
