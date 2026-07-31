import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SERVICES,
  OPTIONAL_SERVICES,
  ALL_SERVICES,
  FULL_ACCESS_SENTINEL,
  isFullAccess,
} from './scopes.js';

describe('scopes vocabulary', () => {
  it('defaults to the mainstream Workspace user services', () => {
    expect(DEFAULT_SERVICES).toEqual([
      'gmail',
      'calendar',
      'drive',
      'docs',
      'sheets',
      'slides',
      'tasks',
      'keep',
      'people',
      'chat',
      'meet',
      'forms',
    ]);
  });

  it('keeps education/admin services out of the default (opt-in only)', () => {
    expect(OPTIONAL_SERVICES).toEqual(['classroom', 'admin-reports']);
    for (const svc of OPTIONAL_SERVICES) {
      expect(DEFAULT_SERVICES).not.toContain(svc);
    }
  });

  it('ALL_SERVICES is default-first and has no duplicates', () => {
    expect(ALL_SERVICES.slice(0, DEFAULT_SERVICES.length)).toEqual([...DEFAULT_SERVICES]);
    expect(new Set(ALL_SERVICES).size).toBe(ALL_SERVICES.length);
  });

  it('the full-access sentinel is not a real service name', () => {
    expect(ALL_SERVICES).not.toContain(FULL_ACCESS_SENTINEL);
  });
});

describe('isFullAccess', () => {
  it('is true only when the sentinel is present', () => {
    expect(isFullAccess([FULL_ACCESS_SENTINEL])).toBe(true);
    expect(isFullAccess(['gmail', FULL_ACCESS_SENTINEL])).toBe(true);
  });

  it('is false for ordinary service lists and empty/undefined input', () => {
    expect(isFullAccess(['gmail', 'drive'])).toBe(false);
    expect(isFullAccess([])).toBe(false);
    expect(isFullAccess(undefined)).toBe(false);
  });
});
