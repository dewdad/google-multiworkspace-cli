import { describe, it, expect } from 'vitest';
import { isTokenStale } from './reauth.js';

describe('isTokenStale', () => {
  it('treats a missing status payload as stale (probe failed → still re-auth)', () => {
    expect(isTokenStale(null)).toBe(true);
  });

  it('is fresh only when token_valid is strictly true', () => {
    expect(isTokenStale({ token_valid: true })).toBe(false);
  });

  it('is stale when token_valid is false', () => {
    expect(isTokenStale({ token_valid: false })).toBe(true);
  });

  it('is stale when token_valid is absent from the payload', () => {
    expect(isTokenStale({ authenticated: true })).toBe(true);
  });
});
