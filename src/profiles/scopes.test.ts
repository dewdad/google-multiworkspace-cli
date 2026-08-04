import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SERVICES,
  OPTIONAL_SERVICES,
  ALL_SERVICES,
  FULL_ACCESS_SENTINEL,
  SCOPE_CAP,
  isFullAccess,
  willExceedScopeCap,
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

describe('willExceedScopeCap', () => {
  it('exposes the ~25-scope testing-mode ceiling', () => {
    expect(SCOPE_CAP).toBe(25);
  });

  it('is always true for full access', () => {
    expect(willExceedScopeCap([FULL_ACCESS_SENTINEL], true)).toBe(true);
    expect(willExceedScopeCap(undefined, true)).toBe(true);
  });

  it('is false for the default service set (sits just under the cap)', () => {
    expect(willExceedScopeCap([...DEFAULT_SERVICES], false)).toBe(false);
  });

  it('is false for a narrowed set and empty/undefined input', () => {
    expect(willExceedScopeCap(['gmail', 'calendar', 'drive'], false)).toBe(false);
    expect(willExceedScopeCap([], false)).toBe(false);
    expect(willExceedScopeCap(undefined, false)).toBe(false);
  });

  it('is true when a privileged opt-in service (classroom/admin-reports) is present', () => {
    expect(willExceedScopeCap(['gmail', 'drive', 'classroom'], false)).toBe(true);
    expect(willExceedScopeCap(['gmail', 'admin-reports'], false)).toBe(true);
  });

  it('is true when the set is larger than the default service set', () => {
    expect(willExceedScopeCap([...DEFAULT_SERVICES, 'classroom'], false)).toBe(true);
  });

  it('ignores a stray full-access sentinel when counting a non-full set', () => {
    expect(willExceedScopeCap([FULL_ACCESS_SENTINEL, 'gmail', 'drive'], false)).toBe(false);
  });
});
