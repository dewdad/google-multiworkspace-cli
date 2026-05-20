import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GwcliError } from '../types/index.js';

vi.mock('../profiles/resolver.js', () => ({
  resolveProfile: vi.fn(),
}));
vi.mock('../gws/runner.js', () => ({
  runGws: vi.fn(),
}));

const { resolveProfile } = await import('../profiles/resolver.js');
const { runGws } = await import('../gws/runner.js');
const { runAgenda } = await import('./agenda.js');

const FROZEN_NOW = new Date('2026-05-20T12:00:00.000Z');

describe('runAgenda', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}__`);
    }) as never);
    vi.mocked(resolveProfile).mockReturnValue({
      name: 'work',
      gwsConfigDir: '/mock/work/gws',
      meta: {
        name: 'work',
        displayName: 'Work',
        email: 'me@work.com',
        createdAt: '2026-01-01T00:00:00Z',
        lastUsed: null,
        scopes: ['gmail', 'calendar'],
        clientSecretSource: '/mock/secret.json',
        tags: [],
      },
    });
    vi.mocked(runGws).mockReturnValue({ exitCode: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('rejects non-positive days with INVALID_AGENDA_DAYS', () => {
    expect(() =>
      runAgenda({ days: 0, calendarId: 'primary', maxResults: 10 })
    ).toThrow(GwcliError);
    expect(() =>
      runAgenda({ days: -1, calendarId: 'primary', maxResults: 10 })
    ).toThrow(/Invalid --days value/);
    expect(() =>
      runAgenda({ days: NaN, calendarId: 'primary', maxResults: 10 })
    ).toThrow(GwcliError);
  });

  it('composes a [now, now+days] time window in UTC ISO format', () => {
    expect(() =>
      runAgenda({ days: 7, calendarId: 'primary', maxResults: 50 })
    ).toThrow('__exit_0__');

    expect(runGws).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runGws).mock.calls[0]![0];
    const paramsIdx = call.args.indexOf('--params');
    const params = JSON.parse(call.args[paramsIdx + 1]!);

    expect(params.timeMin).toBe('2026-05-20T12:00:00.000Z');
    expect(params.timeMax).toBe('2026-05-27T12:00:00.000Z');
    expect(params.calendarId).toBe('primary');
    expect(params.singleEvents).toBe(true);
    expect(params.orderBy).toBe('startTime');
    expect(params.maxResults).toBe(50);
  });

  it('passes through --calendar to params.calendarId', () => {
    expect(() =>
      runAgenda({ days: 1, calendarId: 'team@company.com', maxResults: 10 })
    ).toThrow('__exit_0__');

    const call = vi.mocked(runGws).mock.calls[0]![0];
    const paramsIdx = call.args.indexOf('--params');
    const params = JSON.parse(call.args[paramsIdx + 1]!);
    expect(params.calendarId).toBe('team@company.com');
  });

  it('does NOT pass --fields (gws 0.22.x removed the response mask flag)', () => {
    expect(() =>
      runAgenda({ days: 1, calendarId: 'primary', maxResults: 10 })
    ).toThrow('__exit_0__');

    const call = vi.mocked(runGws).mock.calls[0]![0];
    expect(call.args).not.toContain('--fields');
  });

  it('forwards --format flag when provided', () => {
    expect(() =>
      runAgenda({
        days: 1,
        calendarId: 'primary',
        maxResults: 10,
        formatFlag: 'yaml',
      })
    ).toThrow('__exit_0__');

    const call = vi.mocked(runGws).mock.calls[0]![0];
    expect(call.args).toContain('--format');
    expect(call.args[call.args.indexOf('--format') + 1]).toBe('yaml');
  });

  it('does NOT add --format when not provided', () => {
    expect(() =>
      runAgenda({ days: 1, calendarId: 'primary', maxResults: 10 })
    ).toThrow('__exit_0__');

    const call = vi.mocked(runGws).mock.calls[0]![0];
    expect(call.args).not.toContain('--format');
  });

  it('passes the resolved profile name to runGws', () => {
    expect(() =>
      runAgenda({
        days: 1,
        calendarId: 'primary',
        maxResults: 10,
        profileFlag: 'work',
      })
    ).toThrow('__exit_0__');

    expect(resolveProfile).toHaveBeenCalledWith('work');
    const call = vi.mocked(runGws).mock.calls[0]![0];
    expect(call.profileName).toBe('work');
  });

  it('exits with the gws exit code', () => {
    vi.mocked(runGws).mockReturnValue({ exitCode: 2 });

    expect(() =>
      runAgenda({ days: 1, calendarId: 'primary', maxResults: 10 })
    ).toThrow('__exit_2__');
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
