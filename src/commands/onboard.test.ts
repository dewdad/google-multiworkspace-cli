import { describe, it, expect } from 'vitest';
import { resolveScopeList } from './onboard.js';
import { DEFAULT_SERVICES, FULL_ACCESS_SENTINEL } from '../profiles/scopes.js';

describe('resolveScopeList', () => {
  it('defaults to DEFAULT_SERVICES when no scopes or full flag given', () => {
    const result = resolveScopeList({});
    expect(result.fullAccess).toBe(false);
    expect(result.scopes).toEqual([...DEFAULT_SERVICES]);
  });

  it('parses a comma list, trimming whitespace and dropping empties', () => {
    const result = resolveScopeList({ scopes: ' gmail , calendar ,, drive ' });
    expect(result).toEqual({ scopes: ['gmail', 'calendar', 'drive'], fullAccess: false });
  });

  it('returns the full-access sentinel when full is true, ignoring scopes', () => {
    const result = resolveScopeList({ full: true, scopes: 'gmail,calendar' });
    expect(result).toEqual({ scopes: [FULL_ACCESS_SENTINEL], fullAccess: true });
  });
});
