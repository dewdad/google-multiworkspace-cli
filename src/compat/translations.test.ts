import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryTranslateCompat } from './translations.js';

describe('tryTranslateCompat', () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  it('returns null for fewer than 2 args', () => {
    expect(tryTranslateCompat([])).toBeNull();
    expect(tryTranslateCompat(['gmail'])).toBeNull();
  });

  it('returns null for unknown two-word commands', () => {
    expect(tryTranslateCompat(['unknown', 'foo'])).toBeNull();
  });

  it('translates the v1 "gmail list" alias', () => {
    const out = tryTranslateCompat(['gmail', 'list', '--limit', '5']);
    expect(out).not.toBeNull();
    expect(out![0]).toBe('gmail');
    expect(out![1]).toBe('users');
    expect(out![2]).toBe('messages');
    expect(out![3]).toBe('list');
    expect(stderr).toHaveBeenCalled();
  });

  it('translates v1 "calendar events --days 3" to a valid gws events.list window', () => {
    const out = tryTranslateCompat(['calendar', 'events', '--days', '3']);
    expect(out).not.toBeNull();
    expect(out!.slice(0, 4)).toEqual(['calendar', 'events', 'list', '--params']);
    const params = JSON.parse(out![4]!) as {
      calendarId: string;
      timeMin: string;
      timeMax: string;
      singleEvents: boolean;
      orderBy: string;
    };
    expect(params.calendarId).toBe('primary');
    expect(params.singleEvents).toBe(true);
    expect(params.orderBy).toBe('startTime');
    const spanDays = (Date.parse(params.timeMax) - Date.parse(params.timeMin)) / 86_400_000;
    expect(Math.round(spanDays)).toBe(3);
    expect(stderr).toHaveBeenCalled();
  });

  it('does NOT translate "calendar events list" — it is native gws syntax (Issue 5)', () => {
    expect(
      tryTranslateCompat(['calendar', 'events', 'list', '--params', '{}'])
    ).toBeNull();
    expect(
      tryTranslateCompat(['calendar', 'events', 'get', '--params', '{}'])
    ).toBeNull();
    expect(
      tryTranslateCompat(['calendar', 'events', 'insert', '--params', '{}'])
    ).toBeNull();
    // No deprecation warning emitted for native syntax.
    expect(stderr).not.toHaveBeenCalled();
  });

  it('does NOT translate when third arg is a non-flag positional', () => {
    // For symmetry: any two-word translation key should pass through if
    // followed by a real third positional.
    expect(tryTranslateCompat(['drive', 'list', 'something'])).toBeNull();
  });

  it('drive search: escapes single quotes in query for Drive query language', () => {
    const out = tryTranslateCompat(['drive', 'search', "O'Brien"]);
    expect(out).not.toBeNull();
    const paramsIdx = out!.indexOf('--params');
    expect(paramsIdx).toBeGreaterThan(-1);
    const parsed = JSON.parse(out![paramsIdx + 1]) as { q: string; pageSize: number };
    expect(parsed.q).toBe("name contains 'O\\'Brien'");
    expect(stderr).toHaveBeenCalled();
  });
});
